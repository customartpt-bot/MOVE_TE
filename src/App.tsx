import { useState, useEffect, useRef, useMemo } from 'react';
import Map from './components/Map';
import CommandPanel from './components/CommandPanel';
import { AttributeTable } from './components/AttributeTable';
import { supabase } from './lib/supabase';
import { motion } from 'motion/react';
import { Table as TableIcon } from 'lucide-react';

// Dynamic Layers System - Using Supabase for boundaries
const CATALOG_LAYERS = [
  { id: 'desp_clubes', name: 'Entidades Desportivas', type: 'data', table: 'vw_entidades_completa' },
  { id: 'adm_concelho', name: 'Limite de Concelho', type: 'geojson_db', table: 'Limite_Concelho_WGS84' },
  { id: 'adm_uniao_freguesias', name: 'Limite de União de Freguesia', type: 'geojson_db', table: 'Limite_UniaoFreguesias_WGS84' },
  { id: 'adm_freguesia', name: 'Limite de Freguesia', type: 'geojson_db', table: 'Limites_Freguesia_WGS84' }
];

export default function App() {
  const [results, setResults] = useState<any[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  
  const [importedLayerIds, setImportedLayerIds] = useState<string[]>([]);
  const [visibleLayerIds, setVisibleLayerIds] = useState<string[]>([]);
  const [externalLayers, setExternalLayers] = useState<any[]>([]);
  const [dbGeoJsonData, setDbGeoJsonData] = useState<Record<string, any>>({});
  const [isTableOpen, setIsTableOpen] = useState(false);

  // Combined data for the map (Ordered for GIS: first in list = top of map)
  const activeLayers = useMemo(() => {
    // 1. Get the catalog layers in the order specified by importedLayerIds
    const sortedCatalog = importedLayerIds
      .map(id => CATALOG_LAYERS.find(l => l.id === id))
      .filter((l): l is typeof CATALOG_LAYERS[number] => !!l);

    // 2. Combine with external layers
    return [
      ...sortedCatalog
        .map(l => l.type === 'geojson_db' ? { ...l, type: 'geojson', data: dbGeoJsonData[l.id] } : l),
      ...externalLayers.filter(l => visibleLayerIds.includes(l.id))
    ].filter(l => {
      // Only keep layers that are visible AND have data if they are geojson
      if (!visibleLayerIds.includes(l.id)) return false;
      if (l.type === 'geojson' && !l.data) return false;
      return true;
    });
  }, [importedLayerIds, visibleLayerIds, dbGeoJsonData, externalLayers]);

  // Fetch GeoJSON from DB when a layer is imported or made visible
  useEffect(() => {
    const fetchLayerData = async (layerId: string) => {
      const layer = CATALOG_LAYERS.find(l => l.id === layerId);
      if (!layer || layer.type !== 'geojson_db' || dbGeoJsonData[layerId]) return;

      try {
        console.log(`Fetching spatial data for: ${layer.table}`);
        const { data, error } = await supabase.from(layer.table!).select('*');
        
        if (error) throw error;

        // Extract features searching thoroughly for any geometry data
        const features = (data || [])
          .map(item => {
            // Priority list for geometry column names in PostGIS
            let geom = item.geom || item.geometry || item.the_geom || item.wkb_geometry;
            
            // If not found by name, look for an object that has 'type' and 'coordinates' (GeoJSON-like)
            if (!geom) {
              const possibleKey = Object.keys(item).find(k => 
                item[k] && typeof item[k] === 'object' && item[k].type && (item[k].coordinates || item[k].geometries)
              );
              if (possibleKey) geom = item[possibleKey];
            }

            if (!geom) return null;
            
            // Handle stringified JSON
            if (typeof geom === 'string') {
              try { geom = JSON.parse(geom); } catch (e) { return null; }
            }

            return {
              type: 'Feature',
              geometry: geom,
              properties: { ...item, geom: undefined, geometry: undefined, the_geom: undefined, wkb_geometry: undefined }
            };
          })
          .filter(f => f !== null && f.geometry);

        if (features.length > 0) {
          console.log(`Successfully loaded ${features.length} features for ${layerId}`);
          setDbGeoJsonData(prev => ({ 
            ...prev, 
            [layerId]: { type: 'FeatureCollection', features } 
          }));
        } else {
          console.warn(`No geometry found in table ${layer.table}`);
        }
      } catch (err) {
        console.error(`Error loading spatial layer ${layerId}:`, err);
      }
    };

    // Trigger fetch for any layer in CATALOG that is visible or imported
    CATALOG_LAYERS.forEach(l => {
      if (l.type === 'geojson_db' && (visibleLayerIds.includes(l.id) || importedLayerIds.includes(l.id))) {
        if (!dbGeoJsonData[l.id]) {
          fetchLayerData(l.id);
        }
      }
    });
  }, [importedLayerIds, visibleLayerIds, dbGeoJsonData]);

  useEffect(() => {
    async function loadLayerData() {
      // If Clubs layer is visible and we don't have results (initial state or cleared), fetch all
      if (visibleLayerIds.includes('desp_clubes')) {
        // We only fetch all if we don't have results yet
        // In a real app, we might want to track if a query is active
      }
    }
    loadLayerData();
  }, [visibleLayerIds]);

  useEffect(() => {
    async function fetchInitialData() {
      try {
        // Fetch from the new view
        const { data, error } = await supabase
          .from('vw_entidades_completa')
          .select('*');
        
        if (error) {
          // Fallback to table if view doesn't exist yet
          const { data: tableData, error: tableError } = await supabase
            .from('Entidades_Desportivas')
            .select('*, geom');
          if (tableError) throw tableError;
          setResults(tableData || []);
        } else {
          setResults(data || []);
        }
      } catch (err) {
        console.error('Error fetching initial data:', err);
      } finally {
        setInitialLoading(false);
      }
    }

    fetchInitialData();
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-pearl p-0 relative">
      {/* Header */}
      <header className="p-8 pb-4 md:px-10 md:pt-8 md:pb-6 flex flex-col md:flex-row justify-between items-start md:items-end gap-6 shrink-0 relative z-50">
        <div>
          <div className="label-micro mb-2">Visualizador Inteligente da Oferta Desportiva de Almada</div>
          <h1 className="brand-title">
            MOVE<span className="text-tech-green">_</span>TE
          </h1>
        </div>
        <div className="text-left md:text-right">
          <div className="status-badge-tech mb-2">● IA ACTIVE (GEMINI-1.5)</div>
          <div className="label-micro">SUPABASE / POSTGIS CONNECTED</div>
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row gap-6 px-4 pb-4 md:px-10 md:pb-8 min-h-0 bg-pearl">
        {/* Left Side: Command Panel */}
        <aside className="w-full md:w-[380px] h-full flex flex-col shrink-0">
          <CommandPanel 
            onResultsUpdate={setResults} 
            resultsCount={results.length} 
            availableLayers={CATALOG_LAYERS}
            importedLayerIds={importedLayerIds}
            visibleLayerIds={visibleLayerIds}
            onToggleImport={(id) => {
              setImportedLayerIds(prev => 
                prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
              );
              // Auto-show when importing
              if (!importedLayerIds.includes(id)) {
                setVisibleLayerIds(prev => Array.from(new Set([...prev, id])));
              }
            }}
            onReorderLayers={setImportedLayerIds}
            onToggleVisibility={(id) => {
              setVisibleLayerIds(prev => 
                prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
              );
            }}
            onAddExternalLayer={(layer) => {
              setExternalLayers(prev => [...prev, layer]);
              setImportedLayerIds(prev => [...prev, layer.id]);
              setVisibleLayerIds(prev => [...prev, layer.id]);
            }}
          />
        </aside>

        {/* Right Side: Map */}
        <div className="flex-1 relative min-h-[400px] md:min-h-0">
          <div className="w-full h-full relative overflow-hidden rounded-sm border-2 border-dark-ink">
            {initialLoading ? (
              <div className="w-full h-full flex flex-col items-center justify-center bg-[#E9E7E0] space-y-4">
                <div className="w-12 h-12 border-4 border-dark-ink border-t-tech-green rounded-full animate-spin" />
                <p className="text-xs font-mono text-dark-ink/40 animate-pulse uppercase tracking-widest">Sincronizando PostGIS...</p>
              </div>
            ) : (
              <Map 
                data={visibleLayerIds.includes('desp_clubes') ? results : []} 
                activeLayers={activeLayers}
              />
            )}

            {/* Floating Table Toggle */}
            <div className="absolute right-4 bottom-10 z-[1000]">
              <button
                onClick={() => setIsTableOpen(!isTableOpen)}
                className="bg-white border-2 border-dark-ink p-3 shadow-bold hover:bg-tech-green transition-all group"
                title="Ver Tabela de Atributos"
              >
                <TableIcon size={20} className="group-hover:scale-110 transition-transform" />
              </button>
            </div>

            {/* Attribute Table Overlay */}
            <AttributeTable 
              data={results.length > 0 ? results : (Object.values(dbGeoJsonData)[0]?.features?.map((f: any) => f.properties) || [])} 
              isOpen={isTableOpen} 
              onClose={() => setIsTableOpen(false)} 
            />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="px-8 py-3 md:px-10 bg-dark-ink text-pearl flex justify-between items-center shrink-0 relative z-50">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em]">MOVE_TE PROJECT © 2026 | Programação & Serviços Web Geoespaciais - NOVA IMS - ALUNO Carlos Jesus 20250796</span>
      </footer>
    </div>
  );
}
