import { useState, useRef } from 'react';
import { Search, Terminal, AlertCircle, Loader2, GripVertical } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { geocodeAddress } from '../services/aiService';
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
  aiExplanation: string | null;
  onResetFilters: () => void;
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
  resultsCount, 
  availableLayers,
  importedLayerIds,
  visibleLayerIds,
  aiExplanation,
  onResetFilters,
  onToggleImport,
  onToggleVisibility,
  onAddExternalLayer,
  onReorderLayers
}: CommandPanelProps) {
  const [ogcUrl, setOgcUrl] = useState('');
  const [ogcType, setOgcType] = useState<'WMS' | 'WFS'>('WMS');
  const [discoveredLayers, setDiscoveredLayers] = useState<{name: string, title: string}[]>([]);
  const [selectedLayer, setSelectedLayer] = useState('');
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const [addressValue, setAddressValue] = useState('');
  const [addressSuggestions, setAddressSuggestions] = useState<any[]>([]);
  const [showAddressPopup, setShowAddressPopup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [activeTab, setActiveTab] = useState<'base' | 'data'>('base');
  
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDiscoverLayers = async () => {
    if (!ogcUrl) {
      setError("Por favor, insira um URL Base.");
      return;
    }
    setIsDiscovering(true);
    setError(null);
    setDiscoveredLayers([]);
    setSelectedLayer('');

    try {
      if (ogcType === 'WFS') {
        if (typeof (window as any).obterCamadasWFS === 'function') {
          const layers = await (window as any).obterCamadasWFS(ogcUrl);
          setDiscoveredLayers(layers);
        } else {
          throw new Error("Script obterCamadasWFS não encontrado.");
        }
      } else {
        if (typeof (window as any).obterCamadasWMS === 'function') {
          const layers = await (window as any).obterCamadasWMS(ogcUrl);
          setDiscoveredLayers(layers);
        } else {
          throw new Error("Script obterCamadasWMS não encontrado.");
        }
      }
    } catch (err: any) {
      setError(`Falha ao descobrir camadas: ${err.message}`);
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;

    if (active && over && active.id !== over.id) {
      const oldIndex = importedLayerIds.indexOf(active.id);
      const newIndex = importedLayerIds.indexOf(over.id);
      onReorderLayers(arrayMove(importedLayerIds, oldIndex, newIndex));
    }
  };

  const fetchAddressSuggestions = async (val: string) => {
    if (val.length < 3) {
      setAddressSuggestions([]);
      setIsSearchingAddress(false);
      return;
    }
    
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearchingAddress(true);
      try {
        let results: any[] = [];
        try {
          const resp = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(val + ', Almada')}&limit=6&lang=pt`);
          if (resp.ok) {
            const data = await resp.json();
            if (data?.features?.length > 0) {
              results = data.features.map((f: any) => ({
                display_name: [f.properties.name, f.properties.street, f.properties.city].filter(Boolean).join(', '),
                lat: f.geometry.coordinates[1],
                lon: f.geometry.coordinates[0]
              }));
            }
          }
        } catch (e) { console.warn('Photon fail', e); }

        if (results.length === 0) {
          const aiGeocode = await geocodeAddress(val + ', Almada, Portugal');
          if (aiGeocode.features?.length > 0) {
            results = aiGeocode.features;
          }
        }
        setAddressSuggestions(results);
      } catch (e) {
        console.error('Final Search error:', e);
        setAddressSuggestions([]);
      } finally {
        setIsSearchingAddress(false);
      }
    }, 400);
  };

  const handleImportLayer = async () => {
    if (!selectedLayer) {
      setError("Por favor, selecione uma camada.");
      return;
    }
    
    setIsImporting(true);
    setError(null);

    try {
      if (ogcType === 'WFS') {
        if (typeof (window as any).importarDadosWFS === 'function') {
          (window as any).importarDadosWFS(ogcUrl, selectedLayer, (err: any, geojson: any) => {
            setIsImporting(false);
            if (err) {
              setError("Erro ao importar WFS: " + err.message);
              return;
            }
            if (geojson) {
              onAddExternalLayer({
                id: `wfs-${Date.now()}`,
                name: selectedLayer,
                type: 'geojson',
                data: geojson
              });
              setDiscoveredLayers([]);
              setSelectedLayer('');
            }
          });
        }
      } else {
        if (typeof (window as any).importarDadosWMS === 'function') {
          const wmsLayerInstance = (window as any).importarDadosWMS(ogcUrl, selectedLayer);
          onAddExternalLayer({
            id: `wms-${Date.now()}`,
            name: selectedLayer,
            type: 'wms',
            url: ogcUrl,
            layers: selectedLayer,
            wmsInstance: wmsLayerInstance
          });
          setDiscoveredLayers([]);
          setSelectedLayer('');
          setIsImporting(false);
        } else if (typeof (window as any).configurarCamadaWMS === 'function') {
          onAddExternalLayer({
            id: `wms-${Date.now()}`,
            name: selectedLayer,
            type: 'wms',
            url: ogcUrl,
            layers: selectedLayer
          });
          setDiscoveredLayers([]);
          setSelectedLayer('');
          setIsImporting(false);
        }
      }
    } catch (err: any) {
      setError(`Erro ao importar: ${err.message}`);
      setIsImporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full gap-4 overflow-hidden px-1">
      <div className="px-3 py-1.5 bg-dark-ink text-pearl text-[9px] font-bold flex justify-between items-center shadow-bold border-2 border-dark-ink shrink-0">
        <div className="flex items-center gap-2">
          <span className="opacity-60 uppercase tracking-widest leading-none">Resultados</span>
          <span className="text-tech-green text-xs font-black">{resultsCount}</span>
        </div>
        <button 
          onClick={onResetFilters}
          className="text-tech-green hover:text-white transition-colors uppercase tracking-widest text-[8px] bg-white/10 px-2 py-0.5 rounded-sm"
        >
          Limpar Filtros
        </button>
      </div>

      <section className="bg-white border-2 border-dark-ink p-4 shadow-bold rounded-sm shrink-0">
        <label className="label-micro block mb-2 leading-none">Localização / Morada</label>
        <div className="relative group">
          <input
            type="text"
            value={addressValue}
            placeholder="Pesquisar morada em Almada..."
            className="w-full bg-pearl border border-gray-200 py-2 pl-3 pr-10 text-[11px] focus:outline-none focus:ring-1 focus:ring-dark-ink transition-all font-medium"
            onChange={(e) => {
              const val = e.target.value;
              setAddressValue(val);
              fetchAddressSuggestions(val);
              setShowAddressPopup(true);
            }}
            onFocus={() => {
              if (addressValue.length >= 3) setShowAddressPopup(true);
            }}
            onBlur={() => setTimeout(() => setShowAddressPopup(false), 250)}
            onKeyDown={async (e) => {
              if (e.key === 'Enter') {
                const val = (e.target as HTMLInputElement).value;
                if (!val) return;
                setIsSearchingAddress(true);
                try {
                  let lat, lon;
                  const pResp = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(val + ', Almada')}&limit=1&lang=pt`);
                  if (pResp.ok) {
                    const pData = await pResp.json();
                    if (pData?.features?.length > 0) {
                      [lon, lat] = pData.features[0].geometry.coordinates;
                    }
                  }
                  if (lat && lon) {
                    window.dispatchEvent(new CustomEvent('map-fly-to', { detail: { lat, lon } }));
                  } else {
                    setError('Não foi possível localizar este endereço.');
                  }
                } catch (err) {
                  console.error('Geocoding error:', err);
                } finally {
                  setIsSearchingAddress(false);
                  setShowAddressPopup(false);
                }
              }
            }}
          />
          <Search size={14} className="absolute right-3 top-2.5 text-gray-400 group-focus-within:text-dark-ink" />

          <AnimatePresence>
            {showAddressPopup && (addressSuggestions.length > 0 || isSearchingAddress) && (
              <motion.div 
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border-2 border-dark-ink shadow-bold rounded-sm overflow-hidden max-h-[220px] overflow-y-auto"
              >
                {isSearchingAddress && addressSuggestions.length === 0 && (
                  <div className="p-3 text-[10px] text-gray-500 flex items-center gap-2 italic">
                    <Loader2 size={12} className="animate-spin text-tech-green" />
                    Procurando...
                  </div>
                )}
                
                {addressSuggestions.map((addr, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setAddressValue(addr.display_name);
                      window.dispatchEvent(new CustomEvent('map-fly-to', { detail: { lat: parseFloat(addr.lat), lon: parseFloat(addr.lon) } }));
                      setShowAddressPopup(false);
                    }}
                    className="w-full text-left px-3 py-2 text-[9px] hover:bg-tech-green/10 border-b border-gray-100 last:border-0 leading-tight group transition-colors"
                  >
                    <div className="font-bold text-dark-ink group-hover:text-tech-green truncate">
                      {addr.display_name.split(',')[0]}
                    </div>
                    <div className="text-gray-400 truncate opacity-80 text-[8px]">
                      {addr.display_name.split(',').slice(1).join(',').trim()}
                    </div>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      <section className="bg-white border-2 border-dark-ink rounded-sm flex-1 flex flex-col min-h-0 overflow-hidden relative">
        <div className="bg-pearl border-b border-dark-ink/10 px-4 py-2 flex justify-between items-center shrink-0">
          <label className="label-micro !mb-0 font-black flex gap-1 items-baseline">
            CONTEÚDO <span className="text-[7px] text-dark-ink/40 font-bold lowercase italic">(escolher dados no catálogo)</span>
          </label>
        </div>

        {aiExplanation && (
          <div className="bg-tech-green/10 border-b border-tech-green/20 px-4 py-2 shrink-0">
            <p className="text-[10px] leading-tight italic text-dark-ink/80 flex gap-2">
              <Terminal size={10} className="shrink-0 mt-0.5" />
              <span>{aiExplanation}</span>
            </p>
          </div>
        )}

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
                <div className="bg-pearl/50 border border-dark-ink/5 p-3 rounded-sm space-y-4">
                  <div className="flex justify-between items-center border-b border-dark-ink/5 pb-1">
                    <p className="text-[10px] font-bold text-dark-ink uppercase tracking-widest">Importar OGC</p>
                    <div className="flex bg-white border border-dark-ink/10 rounded-sm overflow-hidden">
                      <button 
                        onClick={() => { setOgcType('WMS'); setDiscoveredLayers([]); }}
                        className={`px-2 py-0.5 text-[8px] font-bold ${ogcType === 'WMS' ? 'bg-dark-ink text-pearl' : 'text-gray-400'}`}
                      >
                        WMS
                      </button>
                      <button 
                        onClick={() => { setOgcType('WFS'); setDiscoveredLayers([]); }}
                        className={`px-2 py-0.5 text-[8px] font-bold ${ogcType === 'WFS' ? 'bg-dark-ink text-pearl' : 'text-gray-400'}`}
                      >
                        WFS
                      </button>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-[8px] font-black text-gray-400 uppercase tracking-tighter">URL do Serviço</label>
                      <span className="text-[7px] text-gray-300 font-mono italic">standard: {ogcType}</span>
                    </div>
                    <div className="flex gap-1">
                      <input 
                        type="text" 
                        placeholder="Ex: http://geoserver.com/wms"
                        value={ogcUrl}
                        onChange={(e) => setOgcUrl(e.target.value)}
                        className="flex-1 bg-white border border-dark-ink/10 px-2 py-1.5 text-[10px] focus:outline-none focus:border-tech-green transition-all"
                      />
                      <button 
                        onClick={handleDiscoverLayers}
                        disabled={isDiscovering}
                        className="bg-dark-ink text-pearl text-[9px] font-black px-3 py-1.5 uppercase hover:bg-tech-green hover:text-dark-ink transition-all disabled:opacity-50"
                      >
                        {isDiscovering ? '...' : 'Procurar'}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="text-[8px] font-black text-gray-400 uppercase tracking-tighter">Camada Disponível</label>
                    </div>
                    <div className="flex gap-1">
                      <select 
                        value={selectedLayer}
                        onChange={(e) => setSelectedLayer(e.target.value)}
                        className={`flex-1 bg-white border border-dark-ink/10 px-2 py-1.5 text-[10px] focus:outline-none focus:border-tech-green transition-all appearance-none ${discoveredLayers.length === 0 ? 'opacity-50 cursor-not-allowed italic text-gray-400' : ''}`}
                        disabled={discoveredLayers.length === 0 || isDiscovering}
                      >
                        <option value="">{discoveredLayers.length > 0 ? "Escolha uma camada..." : "Aguardando procura..."}</option>
                        {discoveredLayers.map((l, i) => (
                          <option key={i} value={l.name}>{l.title || l.name}</option>
                        ))}
                      </select>
                      <button 
                        onClick={handleImportLayer}
                        disabled={isImporting || !selectedLayer}
                        className="bg-tech-green text-dark-ink text-[9px] font-black px-3 py-1.5 uppercase hover:bg-dark-ink hover:text-pearl transition-all disabled:opacity-50"
                      >
                        {isImporting ? '...' : 'Importar'}
                      </button>
                    </div>
                  </div>
                  
                  {error && (
                    <div className="flex items-center gap-1 text-[9px] font-bold text-red-500 uppercase tracking-tighter bg-red-50 p-2 border border-red-100">
                      <AlertCircle size={10} /> <span>{error}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="pt-2">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 px-1">Conjuntos Locais</p>
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
