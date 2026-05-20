import { useState, useRef } from 'react';
import { Search, Loader2, Terminal } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { translateToSQL } from '../services/aiService';
import { supabase } from '../lib/supabase';

interface FloatingAIProps {
  onResultsUpdate: (results: any[]) => void;
  onExplanationUpdate: (explanation: string | null) => void;
}

export default function FloatingAI({ onResultsUpdate, onExplanationUpdate }: FloatingAIProps) {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalitySuggestions, setModalitySuggestions] = useState<string[]>([]);
  const [showModalityPopup, setShowModalityPopup] = useState(false);
  
  const modalityTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const knownModalities = [
    'Futebol', 'Vólei', 'Basquetebol', 'Andebol', 'Ténis', 'Padel', 'Natação', 'Hidroginástica',
    'Karaté', 'Judo', 'Taekwondo', 'Yoga', 'Pilates', 'Zumba', 'Ginásio', 'Musculação', 'Fitness',
    'Crossfit', 'Ciclismo', 'Atletismo', 'Rugby', 'Surf', 'Skate', 'Xadrez', 'Ténis de Mesa', 'Badminton',
    'Boxe', 'Kickboxing', 'Muay Thai', 'MMA', 'Artes Marciais', 'Ginástica Artística', 'Ginástica Rítmica',
    'Patinagem', 'Dança', 'Ballet', 'Hóquei', 'Canoagem', 'Remo', 'Vela', 'Escalada'
  ];

  const handleAiInputChange = (val: string) => {
    setQuery(val);
    
    if (modalityTimeoutRef.current) clearTimeout(modalityTimeoutRef.current);
    
    modalityTimeoutRef.current = setTimeout(() => {
      const words = val.split(/[\s,]+/);
      const lastWord = words.pop() || '';
      
      if (lastWord.length > 1) {
        const matches = knownModalities.filter(m => 
          m.toLowerCase().startsWith(lastWord.toLowerCase()) || 
          (m.toLowerCase().includes(lastWord.toLowerCase()) && lastWord.length > 2)
        );
        setModalitySuggestions(matches);
        setShowModalityPopup(matches.length > 0);
      } else {
        setShowModalityPopup(false);
      }
    }, 150);
  };

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const aiResponse = await translateToSQL(query);
      onExplanationUpdate(aiResponse.explanation);
      const { intents } = aiResponse;

      const normalize = (str: string) => 
        str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

      let data: any[] = [];
      
      if (typeof (window as any).carregarClubesDoSupabase === 'function') {
        data = await new Promise((resolve) => {
          (window as any).carregarClubesDoSupabase(supabaseUrl, supabaseKey, (err: any, res: any) => {
            if (!err && res) resolve(res);
            else resolve([]);
          });
        });
      } else {
        const { data: dbData } = await supabase.from('vw_entidades_completa').select('*');
        data = dbData || [];
      }
      
      const filtered = data.filter(item => {
        // Normalize searchable strings from the item
        const itemModalidade = item.modalidade ? normalize(item.modalidade) : '';
        const itemCategoria = item.categoria ? normalize(item.categoria) : '';
        const itemClube = item.nome_clube ? normalize(item.nome_clube) : '';

        // 1. MODALITIES FILTER (OR logic)
        if (intents.modalities && intents.modalities.length > 0) {
          const modalityMatch = intents.modalities.some(t => {
            const term = normalize(t);
            // Check direct fields (PRIORITY 1)
            if (itemModalidade.includes(term) || itemCategoria.includes(term)) return true;
            
            // Check oferta JSON (PRIORITY 2)
            if (item.oferta) {
              try {
                const offers = typeof item.oferta === 'string' ? JSON.parse(item.oferta) : item.oferta;
                if (Array.isArray(offers)) {
                  if (offers.some((o: any) => normalize(o.mod || "").includes(term))) return true;
                }
              } catch (e) { /* ignore */ }
            }

            // Check club name as fallback (PRIORITY 3 - STRICT)
            if (itemClube.includes(term)) {
              const mainModalities = knownModalities.map(m => normalize(m));
              // IF the item has ANY other known modality that is NOT the one we're searching for, do NOT match by club name.
              const otherModalitiesInItem = mainModalities.filter(m => 
                itemModalidade.includes(m) && !m.includes(term) && !term.includes(m)
              );
              
              if (otherModalitiesInItem.length > 0) return false;
              
              // Also ensure the item doesn't have a non-empty modality that is simply not in our "known" list
              if (itemModalidade !== '' && !itemModalidade.includes(term)) return false;

              return true;
            }
            return false;
          });

          if (!modalityMatch) return false;
        }

        // 2. LOCATIONS FILTER
        if (intents.locations && intents.locations.length > 0) {
          const locationMatch = intents.locations.some(l => {
            const term = normalize(l);
            
            const freguesia = item.nome_freguesia ? normalize(item.nome_freguesia) : '';
            const uniao = item.nome_uniao_freguesia ? normalize(item.nome_uniao_freguesia) : '';

            // Correspondência exata ou termo contido apenas na coluna de freguesia
            // Priorizamos a freguesia específica para evitar confusão entre freguesia isolada e união
            if (freguesia === term) return true;
            if (freguesia.includes(term) && !uniao.includes(term)) return true;
            
            // Se não houver match na freguesia simples, tentamos na união mas de forma cautelosa
            if (uniao === term || (uniao.includes(term) && term.length > 5)) return true;

            return false;
          });
          if (!locationMatch) return false;
        }

        // 3. PRICE FILTER
        const itemPriceRaw = String(item.mensalidade || "").replace(/[^\d.]/g, '');
        const summaryPrice = parseFloat(itemPriceRaw);
        const mText = String(item.mensalidade || "").toLowerCase();
        const isFree = mText.includes('gratuito') || mText.includes('isento') || mText === '0';

        const checkPriceMatch = (p: number) => {
          if (intents.min_price !== undefined && p < intents.min_price) return false;
          if (intents.max_price !== undefined && p > intents.max_price) return false;
          if (intents.exact_prices && intents.exact_prices.length > 0 && !intents.exact_prices.includes(p)) return false;
          return true;
        };

        // Check main price or free status
        let priceMatched = false;
        if (isFree) {
            // Free is always matched if price filter is present (usually price filters want <= X)
            // unless min_price is > 0
            priceMatched = (intents.min_price || 0) <= 0;
        } else if (!isNaN(summaryPrice)) {
            priceMatched = checkPriceMatch(summaryPrice);
        }

        // Check offers if main price didn't match
        if (!priceMatched && item.oferta) {
          try {
            const offers = typeof item.oferta === 'string' ? JSON.parse(item.oferta) : item.oferta;
            if (Array.isArray(offers)) {
              priceMatched = offers.some((o: any) => {
                const p = parseFloat(String(o.preco || "").replace(/[^\d.]/g, ''));
                return !isNaN(p) && checkPriceMatch(p);
              });
            }
          } catch (e) { /* ignore */ }
        }

        // Only filter by price if some price intent was detected
        const hasPriceIntent = intents.min_price !== undefined || intents.max_price !== undefined || (intents.exact_prices && intents.exact_prices.length > 0);
        if (hasPriceIntent && !priceMatched) return false;

        return true;
      });

      onResultsUpdate(filtered);
      if (filtered.length === 0) setError('Nenhum resultado encontrado.');

    } catch (err: any) {
      console.error(err);
      setError('Erro ao processar consulta.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="absolute left-4 bottom-10 z-[1001] w-[340px]">
      <motion.div 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="bg-white border-2 border-dark-ink p-4 shadow-bold rounded-sm flex flex-col gap-3"
      >
        <div className="flex justify-between items-center">
          <label className="label-micro !mb-0 leading-none flex items-center gap-2">
            <Terminal size={12} className="text-tech-green" />
            Pergunte à IA
          </label>
          {query && (
            <button 
              onClick={() => { setQuery(''); onExplanationUpdate(null); }}
              className="text-[9px] font-bold text-gray-400 hover:text-dark-ink uppercase tracking-tighter"
            >
              Limpar
            </button>
          )}
        </div>

        <form onSubmit={handleSearch} className="relative">
          <div className="relative group">
            <input
              type="text"
              value={query}
              onChange={(e) => handleAiInputChange(e.target.value)}
              onBlur={() => setTimeout(() => setShowModalityPopup(false), 200)}
              placeholder="Futebol até 20€..."
              className="w-full bg-pearl border-b-2 border-dark-ink/10 py-2 text-[13px] font-medium focus:outline-none focus:border-tech-green transition-all placeholder:text-gray-300 pr-10"
            />

            <AnimatePresence>
              {showModalityPopup && modalitySuggestions.length > 0 && (
                <motion.div 
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="absolute z-50 left-0 right-0 bottom-full mb-1 bg-white border-2 border-dark-ink shadow-bold rounded-sm overflow-hidden"
                >
                  {modalitySuggestions.map((m, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        const words = query.split(/[\s,]+/);
                        words.pop();
                        setQuery([...words, m].join(' ') + ' ');
                        setShowModalityPopup(false);
                      }}
                      className="w-full text-left px-3 py-2 text-[10px] hover:bg-tech-green/10 flex items-center justify-between border-b border-gray-50 last:border-0"
                    >
                      <span className="font-medium text-dark-ink">{m}</span>
                      <span className="text-[8px] text-gray-400 uppercase tracking-tighter">Modalidade</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="absolute right-0 top-0 flex items-center h-full gap-1">
              <button
                type="submit"
                disabled={isLoading}
                className="text-dark-ink p-1.5 hover:text-tech-green disabled:opacity-30 transition-colors"
              >
                {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              </button>
            </div>
          </div>
        </form>

        {error && <p className="text-[9px] text-red-500 font-bold uppercase tracking-tight">{error}</p>}
      </motion.div>
    </div>
  );
}

