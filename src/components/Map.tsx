import { MapContainer, TileLayer, Marker, Popup, useMap, LayersControl, GeoJSON, WMSTileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useState } from 'react';
import L from 'leaflet';

// Fix Leaflet marker icon issue in React
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIconRetina from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIconRetina,
  shadowUrl: markerShadow,
  iconSize: [20, 32], // Reduced from [25, 41]
  iconAnchor: [10, 32], // Adjusted for new size
});

L.Marker.prototype.options.icon = DefaultIcon;

interface MapProps {
  data: any[];
  activeLayers?: any[];
}

// Helper to group data by entity and track modality-price pairs
const groupDataByEntity = (data: any[]) => {
  const groups: { [key: string]: any } = {};
  
  data.forEach(item => {
    const id = item.clube_id || item.nome_clube || item.clube_nome;
    if (!groups[id]) {
      groups[id] = {
        ...item,
        oferta: [{ 
          mod: item.modalidade || item.modalidade_nome, 
          preco: item.mensalidade 
        }]
      };
    } else {
      const mod = item.modalidade || item.modalidade_nome;
      const preco = item.mensalidade;
      // Avoid duplicates in the list
      if (!groups[id].oferta.some((o: any) => o.mod === mod && o.preco === preco)) {
        groups[id].oferta.push({ mod, preco });
      }
    }
  });

  return Object.values(groups);
};

export default function Map({ data, activeLayers = [] }: MapProps) {
  const [bounds, setBounds] = useState<L.LatLngBoundsExpression | null>(null);

  return (
    <div className="w-full h-full relative z-0 map-container-bold">
      <MapContainer 
        center={[38.641, -9.185]} 
        zoom={12} 
        scrollWheelZoom={true} 
        className="w-full h-full"
      >
        <MapEventsHandler data={data} bounds={bounds} setBounds={setBounds} activeLayers={activeLayers} />
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Mapa (OpenStreetMap)">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>

          <LayersControl.BaseLayer name="Satélite (Google)">
            <TileLayer
              attribution='&copy; Google'
              url="https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
            />
          </LayersControl.BaseLayer>

          <LayersControl.BaseLayer name="Satélite Híbrido">
            <TileLayer
              attribution='&copy; Google'
              url="https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
            />
          </LayersControl.BaseLayer>

          <LayersControl.BaseLayer name="Mapa (Carto Light)">
            <TileLayer
              attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            />
          </LayersControl.BaseLayer>
        </LayersControl>

        {/* Render Layers (Reversed because in Leaflet the last rendered layer is on top) */}
        {[...activeLayers].reverse().map((layer) => {
          if (layer.type === 'geojson') {
            const styles: Record<string, any> = {
              adm_concelho: { color: '#000000', weight: 3, fillOpacity: 0.1 },
              adm_uniao_freguesias: { color: '#FFFFFF', weight: 1.5, fillOpacity: 0.05 },
              adm_freguesia: { color: '#FF0000', weight: 1.5, fillOpacity: 0.1 }
            };
            const defaultStyle = { color: '#00CC00', weight: 2, fillOpacity: 0.2 };
            const layerStyle = styles[layer.id] || defaultStyle;

            if (!layer.data || !layer.data.features || layer.data.features.length === 0) return null;

            return (
              <GeoJSON 
                key={layer.id}
                data={layer.data} 
                style={layerStyle}
                onEachFeature={(feature, leafletLayer) => {
                  if (feature.properties) {
                    const title = layer.name || 'Atributos';
                    leafletLayer.bindPopup(`
                      <div class="p-2 font-sans overflow-hidden">
                        <h4 class="font-black text-dark-ink border-b-2 border-dark-ink pb-1 mb-2 uppercase text-[10px] tracking-tight">${title}</h4>
                        <div class="max-h-[150px] overflow-y-auto custom-scrollbar text-[9px]">
                          ${Object.entries(feature.properties).map(([k, v]) => {
                            if (!v || typeof v === 'object' || k.toLowerCase().includes('geom')) return '';
                            return `
                              <div class="flex flex-col py-1 border-b border-dark-ink/5">
                                <span class="text-gray-400 font-mono uppercase text-[7px]">${k.replace(/_/g, ' ')}</span>
                                <span class="font-bold text-dark-ink truncate">${v}</span>
                              </div>
                            `;
                          }).join('')}
                        </div>
                      </div>
                    `, { maxWidth: 240 });
                  }
                }}
              />
            );
          }
          if (layer.type === 'wms') {
            return (
              <WMSTileLayer
                key={layer.id}
                url={layer.url}
                params={{
                  layers: layer.layers || '0',
                  format: 'image/png',
                  transparent: true,
                  version: '1.1.0',
                  tiled: true
                } as any}
              />
            );
          }
          return null;
        })}
        
        {/* Markers usually go in top pane automatically */}
        {groupDataByEntity(data).map((item, idx) => {
          const geometry = item.geom || item.geometry || item.the_geom;
          if (!geometry || !geometry.coordinates) return null;
          
          let lon, lat;
          if (Array.isArray(geometry.coordinates[0])) {
            [lon, lat] = geometry.coordinates[0];
          } else {
            [lon, lat] = geometry.coordinates;
          }
          
          if (isNaN(lat) || isNaN(lon)) return null;
          
          const modalidadeList = item.oferta
            .map((o: any) => o.mod)
            .filter(Boolean)
            .join(', ');
          
          const itemKey = item.clube_id || item.nome_clube || item.clube_nome || `marker-${idx}`;
          
          return (
            <Marker key={itemKey} position={[lat, lon]}>
              <Popup className="bold-theme-popup">
                <div className="p-1 min-w-[240px] font-sans">
                  <div className="label-micro text-tech-green mb-1 uppercase tracking-widest">
                    Modalidades disponíveis:
                  </div>
                  <div className="text-[10px] text-dark-ink font-bold mb-2 uppercase leading-tight">
                    {modalidadeList || 'Não especificadas'}
                  </div>
                  
                  <h3 className="font-black text-dark-ink text-xl uppercase leading-tight mb-2 tracking-tighter border-b border-dark-ink/10 pb-2">
                    {item.nome_clube || item.nome || item.clube_nome}
                  </h3>
                  
                  <div className="space-y-1.5 mb-3">
                    <p className="text-[10px] text-gray-500 font-mono flex flex-col">
                      <span className="text-[8px] font-bold opacity-50 uppercase">Endereço:</span>
                      <span className="text-dark-ink font-semibold leading-tight">{item.morada}</span>
                    </p>
                    
                    {item.email && (
                      <p className="text-[10px] text-gray-500 font-mono flex flex-col">
                        <span className="text-[8px] font-bold opacity-50 uppercase">Email:</span>
                        <span className="text-dark-ink font-semibold break-all">{item.email}</span>
                      </p>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      {item.telefone && (
                        <p className="text-[10px] text-gray-500 font-mono flex flex-col">
                          <span className="text-[8px] font-bold opacity-50 uppercase">Telefone:</span>
                          <span className="text-dark-ink font-semibold">{item.telefone}</span>
                        </p>
                      )}
                      {item.website && (
                        <p className="text-[10px] text-gray-500 font-mono flex flex-col">
                          <span className="text-[8px] font-bold opacity-50 uppercase">Site:</span>
                          <a href={item.website.startsWith('http') ? item.website : `https://${item.website}`} target="_blank" rel="noreferrer" className="text-tech-green font-bold truncate">LINK EXTERNO</a>
                        </p>
                      )}
                    </div>
                  </div>
                  
                  <div className="bg-dark-ink text-pearl p-2 rounded-sm">
                    <div className="text-[8px] font-bold tracking-widest uppercase opacity-70 mb-1 border-b border-pearl/20 pb-1">
                      Mensalidades
                    </div>
                    <div className="space-y-1 max-h-[80px] overflow-y-auto custom-scrollbar">
                      {item.oferta.map((o: any, i: number) => (
                        <div key={i} className="flex justify-between items-center text-[10px]">
                          <span className="truncate mr-2 opacity-90 uppercase">{o.mod || 'Geral'}:</span>
                          <span className="text-tech-green font-black">{o.preco ? `${o.preco}€` : 'N/A'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}

function MapEventsHandler({ data, bounds, setBounds, activeLayers }: { data: any[], bounds: L.LatLngBoundsExpression | null, setBounds: (b: any) => void, activeLayers: any[] }) {
  const map = useMap();

  // Fit bounds for markers
  useEffect(() => {
    const handleFlyTo = (e: any) => {
      const { lat, lon } = e.detail;
      map.flyTo([lat, lon], 17, { duration: 2 });
    };

    window.addEventListener('map-fly-to', handleFlyTo);
    return () => window.removeEventListener('map-fly-to', handleFlyTo);
  }, [map]);

  // Fit bounds for GeoJSON layers
  useEffect(() => {
    if (!map) return;
    const geojsonLayers = activeLayers.filter(l => l.type === 'geojson' && l.data && l.data.features && l.data.features.length > 0);
    if (geojsonLayers.length > 0) {
      const timer = setTimeout(() => {
        try {
          const group = new L.FeatureGroup();
          geojsonLayers.forEach(l => {
            const geoLayer = L.geoJSON(l.data);
            group.addLayer(geoLayer);
          });
          const layerBounds = group.getBounds();
          if (layerBounds.isValid()) {
            map.fitBounds(layerBounds, { padding: [50, 50] });
          }
        } catch (err) {
          console.warn('Error fitting bounds:', err);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [activeLayers, map]);

  return null;
}
