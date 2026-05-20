import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

const SYSTEM_PROMPT = `
You are an expert SQL architect for the MOVE_TE project in Almada, Portugal.
Your task is to translate natural language user questions into valid PostGIS SQL queries.

DATABASE SCHEMA:
1. View "vw_entidades_completa":
   - nome_clube (text)
   - morada (text)
   - nome_uniao_freguesia (text)
   - nome_freguesia (text)
   - modalidade (text)
   - categoria (text)
   - mensalidade (text)
   - email (text)
   - website (text)
   - telefone (text)
   - oferta (jsonb): Array of objects with "mod" and "preco" (numeric)
   - geom (geometry: MultiPoint, 4326)

2. Table "Limites_Freguesia_WGS84":
   - nome (text): Granular freguesia name (e.g. 'Cova da Piedade', 'Feijó', 'Laranjeiro', 'Charneca de Caparica')
   - geom (geometry: MultiPolygon, 4326)

RULES:
1. Return ONLY a JSON object with: "sql" (string) and "explanation" (Portuguese description).
2. For modality searches, use ILIKE '%term%' on 'modalidade' or 'categoria'.
3. PRICE FILTERING: 
   - STRICT INTENT: "até X" implies <=, "entre X e Y" implies BETWEEN, "a X e Y" implies IN (X, Y).
   - If no operator is clear but price numbers exist, assume EXACT (IN) if multiple numbers, or LESS THAN OR EQUAL (<=) if one number.
   - Use 'mensalidade' column (numeric extraction: NULLIF(regexp_replace(e.mensalidade, '[^0-9.]', '', 'g'), '')::numeric)
   - AND/OR the 'oferta' JSONB array.
   Example Exact List (10, 15): ((NULLIF(regexp_replace(e.mensalidade, '[^0-9.]', '', 'g'), '')::numeric IN (10, 15)) OR EXISTS (SELECT 1 FROM jsonb_array_elements(e.oferta) as o WHERE (o->>'preco')::numeric IN (10, 15)))
   Example Range (10-15): ((temp_price BETWEEN 10 AND 15) OR EXISTS(... preco BETWEEN 10 AND 15))
4. MULTIPLE ACTIVITIES: If many sports are requested (e.g. "vólei e futebol"), use (e.modalidade ILIKE '%futebol%' OR e.modalidade ILIKE '%volei%' OR ...)
5. LOCATION FILTERING: Joins with "Limites_Freguesia_WGS84" (f) on ST_Intersects.
6. Na explicação, confirma os parâmetros: "Pesquisando por [modalidade] com valor [preço]".
8. ALWAYS ensure the "geom" column from the entities is selected.
9. Robustness: Map verbs like "jogar", "treinar", "fazer", "querer", "praticar" to intent.
10. Use ILIKE for all text comparisons.
`;

export interface AISqlResponse {
  sql: string;
  explanation: string;
  intents: {
    modalities: string[];
    locations: string[];
    min_price?: number;
    max_price?: number;
    exact_prices?: number[];
  };
}

export async function translateToSQL(query: string): Promise<AISqlResponse> {
  const PROMPT_WITH_EXAMPLES = `
    ${SYSTEM_PROMPT}
    
    INTENT EXTRACTION RULES:
    - "modalities": Array of strings (e.g., ["futebol", "andebol"]).
    - "locations": Array of strings. Extract only the place name (e.g., "Caparica", "Laranjeiro"). Remove prefixes like "freguesia de", "união de freguesias", "concelho".
    - "min_price": Number if "desde", "entre X e Y" (X), or "> X".
    - "max_price": Number if "até", "máximo", "entre X e Y" (Y), or "< X".
    - "exact_prices": Array if specific values mentioned (e.g., "por 10€ ou 15€").

    FEW-SHOT EXAMPLES:
    1. Query: "Onde posso praticar futebol na Caparica?" 
       Result: { "sql": "...", "explanation": "Pesquisando futebol na Caparica...", "intents": { "modalities": ["futebol"], "locations": ["Caparica"] } }
    
    2. Query: "Modalidades no Laranjeiro ate 20€" 
       Result: { "sql": "...", "explanation": "Pesquisando modalidades no Laranjeiro até 20€...", "intents": { "modalities": [], "locations": ["Laranjeiro"], "max_price": 20 } }
    
    3. Query: "Onde posso praticar futebol ou andebol?" 
       Result: { "sql": "...", "explanation": "Pesquisando futebol ou andebol...", "intents": { "modalities": ["futebol", "andebol"], "locations": [] } }
    
    4. Query: "basquetebol entre 10 e 20€ em Almada" 
       Result: { "sql": "...", "explanation": "Pesquisando basquetebol em Almada entre 10€ e 20€...", "intents": { "modalities": ["basquetebol"], "locations": ["Almada"], "min_price": 10, "max_price": 20 } }

    5. Query: "Mostra-me modalidades na freguesia da Sobreda"
       Result: { "sql": "...", "explanation": "Filtrando modalidades na freguesia da Sobreda...", "intents": { "modalities": [], "locations": ["Sobreda"] } }
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: query,
      config: {
        systemInstruction: PROMPT_WITH_EXAMPLES,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sql: { type: Type.STRING },
            explanation: { type: Type.STRING },
            intents: {
              type: Type.OBJECT,
              properties: {
                modalities: { type: Type.ARRAY, items: { type: Type.STRING } },
                locations: { type: Type.ARRAY, items: { type: Type.STRING } },
                min_price: { type: Type.NUMBER },
                max_price: { type: Type.NUMBER },
                exact_prices: { type: Type.ARRAY, items: { type: Type.NUMBER } }
              },
              required: ["modalities", "locations"]
            }
          },
          required: ["sql", "explanation", "intents"]
        }
      },
    });

    const text = response.text;
    if (!text) throw new Error("AI returned empty response");
    
    return JSON.parse(text) as AISqlResponse;
  } catch (error) {
    console.error("AI Translation Error:", error);
    return {
      sql: "",
      explanation: "Desculpe, não consegui processar o seu pedido técnico neste momento.",
      intents: { modalities: [], locations: [] }
    };
  }
}

export interface GeocodeResponse {
  features: {
    display_name: string;
    lat: number;
    lon: number;
  }[];
}

export async function geocodeAddress(query: string): Promise<GeocodeResponse> {
  const GEO_PROMPT = `
    You are a geocoding engine for Almada, Portugal.
    Given a local address or street name, return its approximate GPS coordinates (WGS84).
    Query: "${query}"
    
    Return a JSON object with a "features" array.
    Each feature has: "display_name", "lat" (number), "lon" (number).
    Focus strictly on Almada region.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: query,
      config: {
        systemInstruction: GEO_PROMPT,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            features: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  display_name: { type: Type.STRING },
                  lat: { type: Type.NUMBER },
                  lon: { type: Type.NUMBER }
                },
                required: ["display_name", "lat", "lon"]
              }
            }
          },
          required: ["features"]
        }
      },
    });

    const text = response.text;
    if (!text) throw new Error("AI returned empty response");
    return JSON.parse(text) as GeocodeResponse;
  } catch (error) {
    console.error("AI Geocoding Error:", error);
    return { features: [] };
  }
}
