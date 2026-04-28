import { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Search, Terminal, AlertCircle, Loader2, GripVertical } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { XMLParser } from 'fast-xml-parser';
import { translateToSQL } from '../services/aiService';
import { supabase } from '../lib/supabase';
import {
  DndContext, 
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface Layer {
  id: string;
  name: string;
  type?: string;
  table?: string;
  url?: string;
  layers?: string;
}

interface CommandPanelProps {
  onResultsUpdate: (results: any[]) => void;
  resultsCount: number;
  availableLayers: Layer[];
  importedLayerIds: string[];
  visibleLayerIds: string[];
  onToggleImport: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onAddExternalLayer: (layer: any) => void;
  onReorderLayers: (newOrder: string[]) => void;
}

function SortableLayerItem({ 
  id, 
  name, 
  isVisible, 
  onToggleVisibility 
}: { 
  id: string, 
  name: string, 
  isVisible: boolean, 
  onToggleVisibility: () => void 
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style}
      className={`flex items-center gap-2 p-2 hover:bg-pearl rounded cursor-default transition-colors border border-transparent ${isDragging ? 'border-tech-green bg-tech-green/10' : 'hover:border-dark-ink/5'} group bg-white`}
    >
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 text-gray-300 hover:text-dark-ink transition-colors">
        <GripVertical size={14} />
      </div>
      <label className="flex items-center gap-2 flex-1 cursor-pointer">
        <input 
          type="checkbox" 
          checked={isVisible} 
          onChange={onToggleVisibility}
          className="accent-tech-green w-3 h-3" 
        />
        <span className="text-xs font-medium group-hover:text-dark-ink">{name}</span>
      </label>
    </div>
  );
}

export default function CommandPanel({ 
  onResultsUpdate, 
  resultsCount, 
  availableLayers,
  importedLayerIds,
  visibleLayerIds,
  onToggleImport,
  onToggleVisibility,
  onAddExternalLayer,
  onReorderLayers
}: CommandPanelProps) {
  const [query, setQuery] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [externalUrl, setExternalUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'base' | 'data'>('base');
  
  // DnD Sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: any) => {
    const { active, over } = event;

    if (active.id !== over.id) {
      const oldIndex = importedLayerIds.indexOf(active.id);
      const newIndex = importedLayerIds.indexOf(over.id);
      onReorderLayers(arrayMove(importedLayerIds, oldIndex, newIndex));
    }
  };
  
  // Web Speech API
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if ('webkitSpeechRecognition' in window) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.lang = 'pt-PT';

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setQuery(transcript);
        setIsListening(false);
      };

      recognitionRef.current.onerror = () => {
        setIsListening(false);
      };
    }
  }, []);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      setIsListening(true);
      recognitionRef.current?.start();
    }
  };

  const handleAddWFS = async () => {
    if (!externalUrl) return;
    setIsImporting(true);
    setError(null);
    try {
      const urlObj = new URL(externalUrl);
      
      // 1. Tentar obter os dados como estão ou forçar GetFeature se faltar o pedido
      if (!urlObj.searchParams.has('request')) {
        urlObj.searchParams.set('request', 'GetFeature');
        urlObj.searchParams.set('service', 'WFS');
        urlObj.searchParams.set('version', '1.1.0');
      }

      let response = await fetch(urlObj.toString());
      if (!response.ok) {
        // Se falhou, talvez seja porque forçamos GetFeature num URL que era só a base
        urlObj.searchParams.set('request', 'GetCapabilities');
        response = await fetch(urlObj.toString());
      }

      if (!response.ok) throw new Error('Falha na ligação ao servidor WFS (Erro HTTP ' + response.status + '). Verifique o CORS.');

      const text = await response.text();
      const parser = new XMLParser({ 
        ignoreAttributes: false,
        attributeNamePrefix: "@_"
      });
      const jsonObj = parser.parse(text);

      // 2. Se for um GetCapabilities, tentar ler a primeira layer e fazer GetFeature
      if (text.includes('WFS_Capabilities') || (jsonObj['wfs:WFS_Capabilities'] || jsonObj['WFS_Capabilities'])) {
        const capabilities = jsonObj['wfs:WFS_Capabilities'] || jsonObj['WFS_Capabilities'];
        const featureTypeList = capabilities.FeatureTypeList || capabilities['wfs:FeatureTypeList'];
        const firstType = featureTypeList?.FeatureType || featureTypeList?.['wfs:FeatureType'];
        const typeName = Array.isArray(firstType) ? firstType[0].Name || firstType[0]['wfs:Name'] : firstType?.Name || firstType?.['wfs:Name'] || firstType?.['@_name'];

        if (!typeName) throw new Error('Serviço detetado mas não foram encontradas camadas (FeatureTypes) públicas.');

        // Refazer o pedido para GetFeature da primeira layer
        urlObj.searchParams.set('request', 'GetFeature');
        urlObj.searchParams.set('typeName', typeName);
        urlObj.searchParams.set('outputFormat', 'application/json'); // Tentar JSON primeiro
        
        let featRes = await fetch(urlObj.toString());
        if (!featRes.ok || !featRes.headers.get('content-type')?.includes('json')) {
          urlObj.searchParams.delete('outputFormat'); // Fallback para XML
          featRes = await fetch(urlObj.toString());
        }
        
        const featText = await featRes.text();
        if (featRes.headers.get('content-type')?.includes('json')) {
          const geojson = JSON.parse(featText);
          onAddExternalLayer({
            id: `wfs-${Date.now()}`,
            name: typeName,
            type: 'geojson',
            data: geojson
          });
        } else {
          // Processar GML do GetFeature
          processGML(featText, typeName);
        }
        setExternalUrl('');
        return;
      }

      // 3. Se já for um GetFeature (XML ou JSON)
      if (text.trim().startsWith('{')) {
        onAddExternalLayer({
          id: `wfs-${Date.now()}`,
          name: `WFS: ${urlObj.host}`,
          type: 'geojson',
          data: JSON.parse(text)
        });
      } else {
        processGML(text, `WFS: ${urlObj.host}`);
      }

      setExternalUrl('');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Erro ao importar WFS.');
    } finally {
      setIsImporting(false);
    }
  };

  const processGML = (xmlText: string, name: string) => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");
    const features: any[] = [];
    
    // 1. Identify where features are located. 
    // Usually inside <wfs:FeatureCollection> as children of <wfs:member> or <gml:featureMember>
    let featureNodes = Array.from(xmlDoc.querySelectorAll('featureMember, member, [localName="featureMember"], [localName="member"]'));
    
    // If we didn't find members, the features might be literal children of the root collection
    if (featureNodes.length === 0) {
      const root = xmlDoc.documentElement;
      if (root.localName.includes('FeatureCollection')) {
        featureNodes = Array.from(root.children);
      }
    }

    featureNodes.forEach((node) => {
      // In a member node, the actual feature is the first child
      const featureNode = node.localName === 'featureMember' || node.localName === 'member' ? node.firstElementChild : node;
      if (!featureNode) return;

      const props: any = {};
      let geometry: any = null;

      // Extract properties and geometry
      const traverse = (el: Element) => {
        if (el.children.length === 0) {
          if (el.textContent?.trim()) {
            props[el.localName] = el.textContent.trim();
          }
        } else {
          // Look for GML geometry elements
          const localName = el.localName.toLowerCase();
          
          // Check for Point
          if (localName === 'point' || el.querySelector('Point, [localName="Point"]')) {
            const pos = el.querySelector('pos, coordinates, [localName="pos"], [localName="coordinates"]');
            if (pos) {
              const coords = pos.textContent?.trim().split(/[\s,]+/).map(Number);
              if (coords && coords.length >= 2) {
                // Heuristic for coordinate order: WFS 1.1+ defaults to Lat,Lon for EPSG:4326
                // Almada service is likely 1.1.0 or 2.0.0. 
                // We'll flip if latitude looks like it's in the second position (between -90 and 90)
                // or if it's explicitly PTTM06 which is X,Y
                if (Math.abs(coords[0]) > 90 && Math.abs(coords[1]) <= 90) {
                  geometry = { type: 'Point', coordinates: [coords[0], coords[1]] };
                } else {
                  geometry = { type: 'Point', coordinates: [coords[1], coords[0]] };
                }
              }
            }
          }
          
          // Check for posList (Lines/Polygons)
          const posList = el.querySelector('posList, coordinates, [localName="posList"], [localName="coordinates"]');
          if (posList && !geometry) {
            const raw = posList.textContent?.trim().split(/[\s,]+/).map(Number) || [];
            if (raw.length >= 4) {
              const shouldFlip = (Math.abs(raw[0]) <= 90 && Math.abs(raw[1]) > 90) || 
                                 (Math.abs(raw[0]) <= 90 && Math.abs(raw[1]) <= 180); 
              const coords: number[][] = [];
              for (let j = 0; j < raw.length; j += 2) {
                if (!isNaN(raw[j]) && !isNaN(raw[j + 1])) {
                  coords.push(shouldFlip ? [raw[j + 1], raw[j]] : [raw[j], raw[j + 1]]);
                }
              }
              
              if (coords.length > 1) {
                geometry = { type: 'LineString', coordinates: coords };
              }
            }
          }

          if (!geometry) {
            Array.from(el.children).forEach(traverse);
          }
        }
      };

      traverse(featureNode);

      if (geometry) {
        features.push({ type: 'Feature', geometry, properties: props });
      }
    });

    if (features.length === 0) {
      console.warn('GML Parsing failed for text:', xmlText.substring(0, 500));
      throw new Error('Não foram encontrados dados geográficos compatíveis no XML. Verifique o Formato de Saída do serviço.');
    }

    onAddExternalLayer({
      id: `wfs-xml-${Date.now()}`,
      name: name,
      type: 'geojson',
      data: { type: 'FeatureCollection', features }
    });
  };

  const handleAddWMS = () => {
    if (!externalUrl) return;
    onAddExternalLayer({
      id: `wms-${Date.now()}`,
      name: `WMS: ${new URL(externalUrl).host}`,
      type: 'wms',
      url: externalUrl
    });
    setExternalUrl('');
  };

  const resetFilters = async () => {
    setQuery('');
    setAiExplanation(null);
    setError(null);
    setIsLoading(true);
    try {
      const { data, error } = await supabase.from('vw_entidades_completa').select('*');
      if (!error && data) {
        onResultsUpdate(data);
      } else {
        const { data: tableData } = await supabase.from('Entidades_Desportivas').select('*, geom');
        if (tableData) onResultsUpdate(tableData);
      }
    } catch (err) {
      console.error('Reset error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) {
      resetFilters();
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const aiResponse = await translateToSQL(query);
      setAiExplanation(aiResponse.explanation);

      // Helper to normalize strings for accent-insensitive comparison
      const normalize = (str: string) => 
        str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

      const normalizedQuery = normalize(query);
      
      // Detection for price filters (e.g. "até 15", "10€", "20 euros")
      const priceMatch = query.match(/(\d+)[\s]*[€]|(\d+)[\s]*euros/i) || query.match(/(\d+)/);
      const isPriceIntent = normalizedQuery.includes('ate') || 
                           normalizedQuery.includes('menos') || 
                           normalizedQuery.includes('maximo') ||
                           query.includes('€') ||
                           normalizedQuery.includes('euro');
                           
      const targetPrice = priceMatch ? parseInt(priceMatch[1] || priceMatch[2] || priceMatch[0], 10) : null;
      const isPriceFilter = targetPrice !== null && (isPriceIntent || targetPrice < 100); // Heuristic: numbers < 100 are likely prices

      // Extract meaningful keywords
      const sanitizedQuery = normalizedQuery.replace(/[?.,!()[\]{}]/g, ' ');
      const stopWords = ['onde', 'posso', 'praticar', 'ha', 'tem', 'existe', 'o', 'a', 'os', 'as', 'em', 'no', 'na', 'de', 'do', 'da', 'com', 'alguem', 'encontrar', 'um', 'uma', 'ate', 'euros', 'mensalidade', 'preco'];
      const keywords = sanitizedQuery
        .split(/\s+/)
        .filter(w => {
          const isNum = !isNaN(Number(w));
          if (isNum && targetPrice && Number(w) === targetPrice) return false;
          return w.length > 2 && !stopWords.includes(w);
        });
      
      const searchTerms = keywords.length > 0 ? keywords : [];

      const { data, error: dbError } = await supabase
        .from('vw_entidades_completa')
        .select('*');

      if (dbError) throw dbError;
      
      const filtered = (data || []).filter(item => {
        // 1. Price filtering check
        if (targetPrice !== null && isPriceFilter) {
          // Check summary field
          const itemPriceRaw = String(item.mensalidade || "").replace(/[^\d.]/g, '');
          const summaryPrice = parseFloat(itemPriceRaw);
          
          // Also check the oferta array if present
          let hasPriceMatch = !isNaN(summaryPrice) && summaryPrice <= targetPrice;
          
          if (!hasPriceMatch && item.oferta) {
            try {
              const offers = typeof item.oferta === 'string' ? JSON.parse(item.oferta) : item.oferta;
              if (Array.isArray(offers)) {
                hasPriceMatch = offers.some(o => {
                  const p = parseFloat(String(o.preco || "").replace(/[^\d.]/g, ''));
                  return !isNaN(p) && p <= targetPrice;
                });
              }
            } catch (e) { /* ignore */ }
          }

          // Special case: if the club says "Gratuito" or price is 0
          if (!hasPriceMatch) {
            const m = String(item.mensalidade || "").toLowerCase();
            if (m.includes('gratuito') || m.includes('isento') || m === '0') {
              hasPriceMatch = true;
            }
          }

          if (!hasPriceMatch) return false;
          
          // If query was JUST a price or price words, we pass this stage
          if (searchTerms.length === 0) return true;
        }

        // 2. Keyword/Search Terms filtering check
        if (searchTerms.length > 0) {
          return searchTerms.every(term => {
            const t = term.trim();
            if (!t) return true;
            
            const targetFields = [
              { val: item.nome_clube, type: 'text' },
              { val: item.morada, type: 'location' },
              { val: item.modalidade, type: 'text' },
              { val: item.categoria, type: 'text' },
              { val: item.nome_freguesia, type: 'freguesia' },
              { val: item.nome_uniao_freguesia, type: 'freguesia' }
            ];

            // Extract text from oferta array for matching
            let ofertaText = '';
            if (item.oferta) {
              try {
                const offers = typeof item.oferta === 'string' ? JSON.parse(item.oferta) : item.oferta;
                if (Array.isArray(offers)) {
                  ofertaText = offers.map(o => `${o.mod || ''}`).join(' ');
                }
              } catch (e) { /* ignore */ }
            }
            if (ofertaText) {
              targetFields.push({ val: ofertaText, type: 'text' });
            }

            // Specific location sensitivity: if it's a known sub-locality, we should be more inclusive
            const subLocalities = ['piedade', 'feijo', 'laranjeiro', 'cacilhas', 'pragal', 'almada', 'costa', 'trafaria', 'caparica', 'sobreda', 'charneca'];
            const isSubLocalityTerm = subLocalities.includes(t);

            return targetFields.some(field => {
              if (!field.val) return false;
              const nVal = normalize(field.val);
              const matches = nVal.includes(t);
              
              if (matches && isSubLocalityTerm && field.type === 'freguesia') {
                const isUnion = nVal.includes(' e ') || nVal.includes(',') || nVal.includes('uniao');
                if (isUnion) {
                  // Only restrict if the address clearly points to a different sub-locality within the same union
                  const otherSubLocalitiesInUnion = subLocalities.filter(s => s !== t && nVal.includes(s));
                  const moradaMatchesAnother = otherSubLocalitiesInUnion.some(s => item.morada && normalize(item.morada).includes(s));
                  const moradaMatchesThis = item.morada && normalize(item.morada).includes(t);

                  // If address confirms the OTHER part of the union, then we exclude.
                  // Otherwise (no address, or address confirms this part), we allow.
                  if (moradaMatchesAnother && !moradaMatchesThis) return false;
                }
              }
              
              return matches;
            });
          });
        }

        // Default: If it was a price filter without keywords and passed above, it included.
        return true; 
      });

      // Prioritize activity matches (modalidade/categoria/oferta)
      const activityMatches = filtered.filter(item => {
        // Find which terms are actually about activity
        return searchTerms.some(term => {
          const t = term.trim();
          if (!t) return false;
          
          let hasInOferta = false;
          if (item.oferta) {
            try {
              const offers = typeof item.oferta === 'string' ? JSON.parse(item.oferta) : item.oferta;
              if (Array.isArray(offers)) {
                hasInOferta = offers.some(o => normalize(o.mod || "").includes(t));
              }
            } catch (e) { /* ignore */ }
          }

          return (item.modalidade && normalize(item.modalidade).includes(t)) || 
                 (item.categoria && normalize(item.categoria).includes(t)) ||
                 hasInOferta;
        });
      });

      // If we are searching for an activity and found matches, ONLY show those.
      // Otherwise fallback to broader matches.
      const finalResults = (activityMatches.length > 0) ? activityMatches : filtered;
      
      if (finalResults.length === 0 && (searchTerms.length > 0 || isPriceFilter)) {
        setError(`Não foram encontrados resultados para a sua pesquisa.`);
      }
      
      onResultsUpdate(finalResults);

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Erro ao processar consulta.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full gap-4 overflow-hidden px-1">
      {/* Results HUD - Smaller */}
      <div className="px-3 py-1.5 bg-dark-ink text-pearl text-[9px] font-bold flex justify-between items-center shadow-bold border-2 border-dark-ink shrink-0">
        <div className="flex items-center gap-2">
          <span className="opacity-60 uppercase tracking-widest leading-none">Resultados</span>
          <span className="text-tech-green text-xs font-black">{resultsCount}</span>
        </div>
        <button 
          onClick={resetFilters}
          className="text-tech-green hover:text-white transition-colors uppercase tracking-widest text-[8px] bg-white/10 px-2 py-0.5 rounded-sm"
        >
          Limpar Filtros
        </button>
      </div>

      {/* Address Search Bar */}
      <section className="bg-white border-2 border-dark-ink p-4 shadow-bold rounded-sm shrink-0">
        <label className="label-micro block mb-2 leading-none">Localização / Morada</label>
        <div className="relative group">
          <input
            type="text"
            placeholder="Pesquisar morada em Almada..."
            className="w-full bg-pearl border border-gray-200 py-2 pl-3 pr-10 text-[11px] focus:outline-none focus:ring-1 focus:ring-dark-ink transition-all font-medium"
            onKeyDown={async (e) => {
              if (e.key === 'Enter') {
                const val = (e.target as HTMLInputElement).value;
                if (!val) return;
                try {
                  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val + ', Almada, Portugal')}&countrycodes=pt`);
                  const data = await res.json();
                  if (data && data.length > 0) {
                    const { lat, lon } = data[0];
                    window.dispatchEvent(new CustomEvent('map-fly-to', { detail: { lat: parseFloat(lat), lon: parseFloat(lon) } }));
                  }
                } catch (err) {
                  console.error('Geocoding error:', err);
                }
              }
            }}
          />
          <Search size={14} className="absolute right-3 top-2.5 text-gray-400 group-focus-within:text-dark-ink" />
        </div>
      </section>

      {/* Search Section */}
      <section className="bg-white border-2 border-dark-ink p-4 shadow-bold rounded-sm shrink-0 flex flex-col">
        <div className="flex justify-between items-center mb-2">
          <label className="label-micro !mb-0 leading-none">Pergunte à IA</label>
          {query && (
            <button 
              onClick={resetFilters}
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
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Onde praticar zumba..."
              className="w-full bg-pearl border-b-2 border-dark-ink/10 py-2 text-[13px] font-medium focus:outline-none focus:border-tech-green transition-all placeholder:text-gray-300 pr-16"
            />
            <div className="absolute right-0 top-0 flex items-center h-full gap-1">
              <button
                type="button"
                onClick={toggleListening}
                className={`p-1.5 rounded transition-colors ${isListening ? 'bg-red-500 text-white' : 'text-gray-400 hover:text-dark-ink'}`}
              >
                {isListening ? <MicOff size={14} /> : <Mic size={14} />}
              </button>
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
      </section>

      {/* Content Panel */}
      <section className="bg-white border-2 border-dark-ink rounded-sm flex-1 flex flex-col min-h-0 overflow-hidden relative">
        <div className="bg-pearl border-b border-dark-ink/10 px-4 py-2 flex justify-between items-center shrink-0">
          <label className="label-micro !mb-0 font-black flex gap-1 items-baseline">
            CONTEÚDO <span className="text-[7px] text-dark-ink/40 font-bold lowercase italic">(ativar layer em catálogo de dados)</span>
          </label>
        </div>

        {/* AI Insight Bar - Pinned inside the content area for stability */}
        {aiExplanation && !isLoading && (
          <div className="bg-tech-green/10 border-b border-tech-green/20 px-4 py-2 shrink-0">
            <p className="text-[10px] leading-tight italic text-dark-ink/80 flex gap-2">
              <Terminal size={10} className="shrink-0 mt-0.5" />
              <span>{aiExplanation}</span>
            </p>
          </div>
        )}

        
        {/* Tabs */}
        <div className="flex border-b border-dark-ink/10 sticky top-0 bg-white z-10 font-mono text-[9px] font-bold uppercase tracking-widest">
          <button 
            onClick={() => setActiveTab('base')}
            className={`flex-1 py-3 transition-colors border-r border-dark-ink/10 ${activeTab === 'base' ? 'bg-dark-ink text-pearl' : 'hover:bg-pearl'}`}
          >
            Camadas Base
          </button>
          <button 
            onClick={() => setActiveTab('data')}
            className={`flex-1 py-3 transition-colors ${activeTab === 'data' ? 'bg-dark-ink text-pearl' : 'hover:bg-pearl'}`}
          >
            Catálogo de dados
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          <AnimatePresence mode="wait">
            {activeTab === 'base' ? (
              <motion.div 
                key="base"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <div className="flex flex-col gap-1">
                    {importedLayerIds.length === 0 ? (
                      <div className="text-[10px] text-gray-400 italic p-4 text-center border border-dashed border-gray-200">
                        Nenhuma camada ativa. Adicione camadas no Catálogo de Dados.
                      </div>
                    ) : (
                      <DndContext 
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                      >
                        <SortableContext 
                          items={importedLayerIds}
                          strategy={verticalListSortingStrategy}
                        >
                          {importedLayerIds.map(id => {
                            const layer = availableLayers.find(l => l.id === id);
                            if (!layer) return null;
                            return (
                              <SortableLayerItem 
                                key={id}
                                id={id}
                                name={layer.name}
                                isVisible={visibleLayerIds.includes(id)}
                                onToggleVisibility={() => onToggleVisibility(id)}
                              />
                            );
                          })}
                        </SortableContext>
                      </DndContext>
                    )}
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="data"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="space-y-4"
              >
                <div className="space-y-4">
                  <div className="pt-2">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 px-1">Conjuntos Disponíveis</p>
                    <div className="flex flex-col gap-1">
                      {availableLayers.map(layer => (
                        <div key={layer.id} className="flex items-center justify-between p-2 hover:bg-pearl rounded transition-colors group">
                          <span className="text-xs font-medium">{layer.name}</span>
                          <button 
                            onClick={() => onToggleImport(layer.id)}
                            className={`text-[9px] font-black px-2 py-1 rounded-full uppercase tracking-tighter transition-all ${
                              importedLayerIds.includes(layer.id) 
                              ? 'bg-tech-green text-dark-ink' 
                              : 'bg-dark-ink/10 text-dark-ink hover:bg-dark-ink hover:text-pearl'
                            }`}
                          >
                            {importedLayerIds.includes(layer.id) ? 'Remover' : 'Adicionar'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>
    </div>
  );
}
