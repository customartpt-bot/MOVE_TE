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
3. PRICE FILTERING: If the user mentions a price (e.g. "até 10€", "menos de 20 euros"), you MUST add a WHERE clause that checks:
   - The 'mensalidade' column (extract numeric part via regexp_replace(mensalidade, '[^0-9.]', '', 'g'))
   - AND/OR the 'oferta' JSONB array.
   Example for 10€: (NULLIF(regexp_replace(e.mensalidade, '[^0-9.]', '', 'g'), '')::numeric <= 10 OR EXISTS (SELECT 1 FROM jsonb_array_elements(e.oferta) as o WHERE (o->>'preco')::numeric <= 10))
4. LOCATION FILTERING: Use a SPATIAL JOIN with "Limites_Freguesia_WGS84" (f) when specific localities are mentioned (Feijó, Charneca, Piedade, Pragal). Join on ST_Intersects(e.geom, f.geom).
   - "Charneca de Caparica" matches f.nome ILIKE '%Charneca%'.
5. Always combine filters with AND (Conjunctive search).
6. Na explicação, confirma os parâmetros: "Pesquisando por [modalidade] em [localidade] com valor até [preço]€".
7. Always ensure the "geom" column from the entities is selected.
8. Robustness: The client uses accent-insensitive matching.
`;

export interface AISqlResponse {
  sql: string;
  explanation: string;
}

export async function translateToSQL(query: string): Promise<AISqlResponse> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: query,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sql: { type: Type.STRING },
            explanation: { type: Type.STRING }
          },
          required: ["sql", "explanation"]
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
      explanation: "Desculpe, não consegui processar o seu pedido técnico neste momento."
    };
  }
}
