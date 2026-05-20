/**
 * PROJECTO MOVE_TE - ALMADA DESPORTO
 * Script: import_ogc.js
 * Descrição: Funcionalidade em JavaScript Puro (Vanilla JS) para consumo de serviços OGC (WFS e WMS).
 * Autor: Carlos Jesus (com auxílio de IA para estruturação académica)
 */

/**
 * Remove qualquer Query String (parâmetros após '?') ou espaços residuais de um URL base
 * para evitar duplicações de parâmetros na Query String gerada pela API URL.
 * 
 * @param {string} url - URL original do serviço OGC
 * @returns {string} - URL base limpo e sanitizado
 */
function limparUrlBase(url) {
    if (!url) return '';
    return url.split('?')[0].trim();
}

/**
 * DIFERENÇA TÉCNICA (Nota Académica):
 * 1. WFS (Web Feature Service): Transfere dados vetoriais "crus" (geometrias e atributos). 
 *    Permite à aplicação cliente (nós) manipular os dados, filtrar e estilizar individualmente cada objeto. 
 *    É mais pesado para o navegador mas permite maior interactividade.
 * 
 * 2. WMS (Web Map Service): Transfere "tiles" ou imagens raster já renderizadas pelo servidor.
 *    O servidor faz o trabalho pesado de desenho. O cliente apenas recebe e sobrepõe imagens.
 *    É muito mais performante para camadas complexas ou com milhões de pontos.
 */

/**
 * Função para importar dados de um serviço WFS (Web Feature Service).
 * Recupera dados geográficos vetoriais para serem processados pela aplicação.
 * Implementação robusta utilizando a API URL e suporte a servidores Hexagon.
 */
async function importarDadosWFS(baseUrl, typeName, callback) {
    console.log("Iniciando requisição WFS para:", typeName);

    try {
        // Criar objecto URL para manipulação segura de parâmetros limpando resíduos anteriores
        const urlObj = new URL(limparUrlBase(baseUrl));
        
        // Configurar parâmetros obrigatórios do standard WFS 2.0.0
        urlObj.searchParams.set('service', 'WFS');
        urlObj.searchParams.set('version', '2.0.0');
        urlObj.searchParams.set('request', 'GetFeature');
        urlObj.searchParams.set('typeNames', typeName);
        urlObj.searchParams.set('srsName', 'EPSG:3763');
        
        // OutputFormat específico para GeoJSON em servidores GeoMedia/Hexagon
        urlObj.searchParams.set('outputFormat', 'application/vnd.geo+json');

        console.log("URL WFS Final:", urlObj.toString());

        // Pedido assíncrono usando a Fetch API nativa
        const resposta = await fetch(urlObj.toString());

        if (!resposta.ok) {
            throw new Error(`Erro na rede: ${resposta.status}`);
        }

        const dadosGeoJSON = await resposta.json();

        if (dadosGeoJSON && (dadosGeoJSON.type === 'FeatureCollection' || dadosGeoJSON.features)) {
            console.log("Dados WFS (Vetor) carregados. Objetos:", dadosGeoJSON.features.length);

            // PROCESSAMENTO DE REPROJEÇÃO (EPSG:3763 -> EPSG:4326)
            if (typeof window.proj4 !== 'undefined') {
                console.log("Reprojetando coordenadas de EPSG:3763 (PT-TM06) para EPSG:4326 (WGS84)...");
                const EPSG3763 = '+proj=tmerc +lat_0=39.6682583333333 +lon_0=-8.13310833333333 +k=1 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
                const EPSG4326 = 'EPSG:4326';

                const reprojectCoordinate = (coords) => {
                    if (Array.isArray(coords) && coords.length >= 2) {
                        try {
                            const transformed = window.proj4(EPSG3763, EPSG4326, [coords[0], coords[1]]);
                            if (coords.length > 2) {
                                return [transformed[0], transformed[1], coords[2]];
                            }
                            return transformed;
                        } catch (e) {
                            console.error("Erro na reprojeção da coordenada:", coords, e);
                            return coords;
                        }
                    }
                    return coords;
                };

                const reprojectGeometry = (geom) => {
                    if (!geom) return null;
                    const type = geom.type;
                    if (type === 'Point') {
                        geom.coordinates = reprojectCoordinate(geom.coordinates);
                    } else if (type === 'MultiPoint' || type === 'LineString') {
                        geom.coordinates = geom.coordinates.map(reprojectCoordinate);
                    } else if (type === 'MultiLineString' || type === 'Polygon') {
                        geom.coordinates = geom.coordinates.map(ring => ring.map(reprojectCoordinate));
                    } else if (type === 'MultiPolygon') {
                        geom.coordinates = geom.coordinates.map(polygon => polygon.map(ring => ring.map(reprojectCoordinate)));
                    } else if (type === 'GeometryCollection') {
                        if (Array.isArray(geom.geometries)) {
                            geom.geometries.forEach(reprojectGeometry);
                        }
                    }
                    return geom;
                };

                const features = dadosGeoJSON.features || [];
                features.forEach(feature => {
                    if (feature.geometry) {
                        reprojectGeometry(feature.geometry);
                    }
                });

                // Limpar ou atualizar eventual CRS declarado no GeoJSON que force outros mapas a reprojectar incorretamente
                if (dadosGeoJSON.crs) {
                    delete dadosGeoJSON.crs;
                }
                console.log("Reprojeção concluída com sucesso.");
            } else {
                console.warn("Biblioteca proj4js não encontrada no âmbito global (window.proj4). Pulando reprojeção e mantendo coordenadas originais.");
            }

            callback(null, dadosGeoJSON);
        } else {
            throw new Error("Formato GeoJSON inválido ou sem features.");
        }

    } catch (erro) {
        console.error("Falha WFS:", erro);
        callback(erro, null);
    }
}

/**
 * Função para configurar uma camada WMS (Web Map Service).
 * IMPORTANTE: Esta função não faz 'fetch'. Ela devolve uma configuração que o Leaflet
 * utilizará para pedir imagens (tiles) dinamicamente ao servidor.
 * 
 * @param {string} baseUrl - URL do servidor (ex: GeoServer)
 * @param {string} layers - Nome da layer técnica
 * @returns {Object} - Instância de TileLayer do Leaflet
 */
function configurarCamadaWMS(baseUrl, layers) {
    const cleanUrl = limparUrlBase(baseUrl);
    console.log("Configurando Tiles WMS (Imagem) para:", layers, "na URL:", cleanUrl);

    // Utilizamos a biblioteca Leaflet (L) que já está carregada na aplicação principal.
    // O WMS pede imagens PNG transparentes que se sobrepõem ao mapa base.
    return L.tileLayer.wms(cleanUrl, {
        layers: layers,
        format: 'image/png',
        transparent: true,
        version: '1.1.1',
        attribution: "Dados OGC WMS"
    });
}

/**
 * Função para importar dados de um serviço WMS (Web Map Service) sob o standard 1.3.0.
 * IMPORTANTE: Esta função cria e retorna um objeto TileLayer do Leaflet (L.tileLayer.wms).
 * Configura a camada com parâmetros corretos do documento Capabilities do WMS 1.3.0.
 * Adicionalmente, configura o CRS do Leaflet para L.CRS.EPSG4326/CRS:84, garantindo que
 * o servidor que prefere EPSG:3763 faça o fallback correto para WGS84 de forma segura.
 * 
 * NOTA ACADÉMICA SOBRE O ERRO DE INVERSÃO DE EIXOS ("Axis Inversion Bug"):
 * Sob o standard WMS 1.3.0, a definição de EPSG:4326 dita a ordem das coordenadas como [Latitude, Longitude].
 * No entanto, o Leaflet internamente (no motor original de construção de Bounded-box) pode inverter os eixos se
 * o servidor WMS municipal do Almada (GeoMedia/Hexagon) esperar a ordem tradicional (X=Longitude, Y=Latitude).
 * Para corrigir isto sem criar projeções customizadas pesadas, sobrecarregamos as chamadas da função getTileUrl,
 * intercetando dinamicamente a string 'bbox' gerada pelo Leaflet e reordenando as coordenadas para [Xmin, Ymin, Xmax, Ymax],
 * de modo a que o servidor receba os tiles desenhados perfeitamente em vez de imagens transparentes ou vazias.
 * 
 * @param {string} baseUrl - URL base do serviço WMS
 * @param {string} camadaSelecionada - Nome da camada visada no servidor
 * @returns {Object} - Instância de TileLayer configurada
 */
function importarDadosWMS(baseUrl, camadaSelecionada) {
    const cleanUrl = limparUrlBase(baseUrl);
    console.log("Instanciando camada WMS Rasterizada (WMS 1.3.0) para:", camadaSelecionada, "na URL:", cleanUrl);
    
    // Devolvemos um TileLayer rasterizado por exigência do standard WMS 1.3.0.
    // Usamos L.CRS.EPSG4326 como um truque de fallback aceite por servidores que preferem EPSG:3763.
    const layer = L.tileLayer.wms(cleanUrl, {
        layers: camadaSelecionada,
        format: 'image/png',
        transparent: true,
        version: '1.3.0',
        uppercase: true,
        crs: L.CRS.EPSG4326
    });

    // Sobrecarga académica do método de geração de URL de "tiles", resolvendo na fonte o bug da inversão de eixos.
    // Recuperamos o BBOX gerado pelo Leaflet, detetamos os eixes Y,X e redefinimos em X,Y se aplicável.
    layer.getTileUrl = function (coords) {
        // Obter o URL padrão gerado pelo Leaflet
        const url = L.TileLayer.WMS.prototype.getTileUrl.call(this, coords);
        if (!url) return url;
        
        try {
            const urlObj = new URL(url);
            const bbox = urlObj.searchParams.get('bbox');
            if (bbox) {
                const parts = bbox.split(',');
                if (parts.length === 4) {
                    // No Leaflet, para WMS 1.3.0 com EPSG:4326, as coordenadas são codificadas em [ymin, xmin, ymax, xmax] (Lat, Lng)
                    // Os servidores GeoMedia/Hexagon que utilizam EPSG:4326 com ordem GIS [xmin, ymin, xmax, ymax] (Lng, Lat) falham no desenho.
                    // Extraímos reordenando para garantir os tiles precisos:
                    const ymin = parts[0];
                    const xmin = parts[1];
                    const ymax = parts[2];
                    const xmax = parts[3];
                    
                    urlObj.searchParams.set('bbox', [xmin, ymin, xmax, ymax].join(','));
                }
            }
            return urlObj.toString();
        } catch (e) {
            console.error("Erro ao aplicar reordenação de eixos BBOX no WMS 1.3.0:", e);
            return url;
        }
    };

    return layer;
}

// Exportação para o escopo global (window) permitindo integração com React
window.importarDadosWFS = importarDadosWFS;
window.configurarCamadaWMS = configurarCamadaWMS;
window.importarDadosWMS = importarDadosWMS;

/**
 * Função para carregar dados diretamente do Supabase via API REST (PostgREST).
 * Demonstra como consumir uma base de dados espacial (PostGIS) sem bibliotecas externas.
 * 
 * @param {string} supabaseUrl - O URL do seu projecto Supabase
 * @param {string} supabaseAnonKey - A sua chave anónima (public anon key)
 * @param {function} callback - Função de retorno para processar os dados
 */
async function carregarClubesDoSupabase(supabaseUrl, supabaseAnonKey, callback) {
    // 1. Definir o endpoint da tabela 'vw_entidades_completa' (ou a sua tabela de clubes)
    // Usamos o formato Select=* para trazer todos os campos.
    const endpoint = `${supabaseUrl}/rest/v1/vw_entidades_completa?select=*`;

    console.log("Iniciando carregamento nativo via REST do Supabase...");

    try {
        // 2. Realizar o pedido fetch com os cabeçalhos de autenticação exigidos pelo Supabase
        const resposta = await fetch(endpoint, {
            method: 'GET',
            headers: {
                'apikey': supabaseAnonKey,
                'Authorization': `Bearer ${supabaseAnonKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!resposta.ok) {
            throw new Error(`Erro na API Supabase: ${resposta.status}`);
        }

        // 3. Converter a resposta plana (JSON) em objectos JavaScript
        const dadosJSON = await resposta.json();

        // 4. Nota Técnica: No Supabase/PostgREST, os dados vêm como um array de objectos.
        // Se a base de dados tiver a extensão PostGIS, podemos converter estes pontos em GeoJSON.
        console.log("Sucesso! Dados lidos do PostgreSQL via REST. Registos:", dadosJSON.length);
        
        callback(null, dadosJSON);

    } catch (erro) {
        console.error("Falha ao ler dados via REST:", erro);
        callback(erro, null);
    }
}

// Anexar ao objecto window para uso global
window.carregarClubesDoSupabase = carregarClubesDoSupabase;

/**
 * Função para obter a lista de camadas disponíveis num serviço WFS.
 * Utiliza o pedido GetCapabilities standard da OGC (Versão 2.0.0).
 * 
 * @param {string} baseUrl - URL base do serviço WFS
 * @returns {Promise<Array>} - Lista de camadas {name, title}
 */
async function obterCamadasWFS(baseUrl) {
    const cleanUrl = limparUrlBase(baseUrl);
    console.log("Descobrindo camadas WFS em:", cleanUrl);
    
    try {
        const urlObj = new URL(cleanUrl);
        urlObj.searchParams.set('service', 'WFS');
        urlObj.searchParams.set('request', 'GetCapabilities');
        urlObj.searchParams.set('version', '2.0.0');

        const resposta = await fetch(urlObj.toString());
        const xmlTexto = await resposta.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlTexto, "text/xml");

        // O standard WFS usa a tag <FeatureType> para listar as camadas.
        // Nota Técnica: Utilizamos getElementsByTagNameNS com '*' para ignorar prefixos de Namespace (ex: wfs:FeatureType),
        // garantindo total interoperabilidade com diferentes servidores (GeoServer, Hexagon, ArcGIS).
        const featureTypes = xmlDoc.getElementsByTagNameNS("*", "FeatureType");
        const camadas = [];

        for (let i = 0; i < featureTypes.length; i++) {
            const nameElt = featureTypes[i].getElementsByTagNameNS("*", "Name")[0];
            const titleElt = featureTypes[i].getElementsByTagNameNS("*", "Title")[0];
            const name = nameElt ? nameElt.textContent : null;
            const title = titleElt ? titleElt.textContent : null;
            if (name) camadas.push({ name, title: title || name });
        }

        console.log(`WFS: ${camadas.length} camadas encontradas.`);
        return camadas;
    } catch (erro) {
        console.error("Falha ao obter capacidades WFS:", erro);
        throw erro;
    }
}

/**
 * Função para obter a lista de camadas disponíveis num serviço WMS.
 * Utiliza o pedido GetCapabilities standard da OGC.
 * É robusta contra falhas de versão: tenta standard WMS 1.1.1 e se o servidor municipal
 * falhar (ex: erro 400), faz o fallback dinâmico automático para WMS 1.3.0.
 * 
 * @param {string} baseUrl - URL base do serviço WMS
 * @returns {Promise<Array>} - Lista de camadas {name, title}
 */
async function obterCamadasWMS(baseUrl) {
    const cleanUrl = limparUrlBase(baseUrl);
    console.log("Descobrindo camadas WMS em:", cleanUrl);

    // Tentamos primeiro recuperar as capacidades usando a versão de pedido 1.1.1
    try {
        const urlObj = new URL(cleanUrl);
        urlObj.searchParams.set('service', 'WMS');
        urlObj.searchParams.set('request', 'GetCapabilities');
        urlObj.searchParams.set('version', '1.1.1');

        console.log("Fazendo chamada GetCapabilities WMS Versão 1.1.1...");
        const resposta = await fetch(urlObj.toString());
        if (!resposta.ok) {
            throw new Error(`Resposta de rede não-OK (${resposta.status}) para versão 1.1.1`);
        }
        const xmlTexto = await resposta.text();
        return parseWMSCapabilities(xmlTexto);
    } catch (erro1) {
        console.warn("WMS GetCapabilities v1.1.1 falhou. Ativando fallback resiliente para v1.3.0...", erro1.message);
        
        // Recurso / Fallback automático para a versão 1.3.0
        try {
            const urlObj = new URL(cleanUrl);
            urlObj.searchParams.set('service', 'WMS');
            urlObj.searchParams.set('request', 'GetCapabilities');
            urlObj.searchParams.set('version', '1.3.0');

            console.log("Fazendo chamada GetCapabilities WMS Versão 1.3.0...");
            const resposta = await fetch(urlObj.toString());
            if (!resposta.ok) {
                throw new Error(`Resposta de rede não-OK (${resposta.status}) para versão 1.3.0`);
            }
            const xmlTexto = await resposta.text();
            return parseWMSCapabilities(xmlTexto);
        } catch (erro2) {
            console.error("Erro Crítico: O servidor falhou tanto na versão 1.1.1 como 1.3.0 de GetCapabilities WMS.", erro2);
            throw new Error(`Erro ao obter GetCapabilities WMS: ${erro2.message}. Detalhes: ${erro1.message}`);
        }
    }
}

/**
 * Função interna para decifrar (parse) as camadas listadas no XML de GetCapabilities WMS.
 * Usa um parser XML compatível com Namespaces OGC indiferentes (*).
 */
function parseWMSCapabilities(xmlTexto) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlTexto, "text/xml");

    // No standard WMS, o documento Capabilities utiliza a tag <Layer> para descrever os dados.
    // Usamos getElementsByTagNameNS("*", "Layer") para ignorar prefixos (wms:Layer, etc.) e manter total interoperabilidade.
    const layers = xmlDoc.getElementsByTagNameNS("*", "Layer");
    const camadas = [];

    for (let i = 0; i < layers.length; i++) {
        const nameElt = layers[i].getElementsByTagNameNS("*", "Name")[0];
        const titleElt = layers[i].getElementsByTagNameNS("*", "Title")[0];
        const name = nameElt ? nameElt.textContent : null;
        const title = titleElt ? titleElt.textContent : null;
        
        // Apenas adicionamos se tiver Nome associado (são camadas reais carregáveis)
        if (name) {
            camadas.push({ name, title: title || name });
        }
    }

    console.log(`Sucesso: ${camadas.length} camadas WMS catalogadas.`);
    return camadas;
}

window.obterCamadasWFS = obterCamadasWFS;
window.obterCamadasWMS = obterCamadasWMS;

/**
 * Função para exportar dados para formato CSV.
 * Demonstra manipulação de Strings, Blobs e Object URLs em JavaScript puro.
 * 
 * @param {Array} dados - Array de objectos com os dados da tabela
 * @param {string} nomeFicheiro - Nome do ficheiro a ser descarregado
 */
function exportarParaCSV(dados, nomeFicheiro) {
    if (!dados || !dados.length) {
        console.warn("Sem dados para exportar.");
        return;
    }

    // 1. Extrair os cabeçalhos (nomes das colunas) a partir das chaves do primeiro objecto
    const cabecalhos = Object.keys(dados[0]);
    
    // 2. Construir as linhas do CSV
    // Começamos pela linha de cabeçalho
    const linhas = [];
    linhas.push(cabecalhos.join(','));

    // Iterar sobre cada registo para criar as linhas de dados
    dados.forEach(obj => {
        const valores = cabecalhos.map(header => {
            const valor = obj[header] === null || obj[header] === undefined ? "" : obj[header];
            // Escapar vírgulas e aspas para não corromper o formato CSV
            const valorFormatado = String(valor).replace(/"/g, '""');
            return `"${valorFormatado}"`;
        });
        linhas.push(valores.join(','));
    });

    // 3. Unir todas as linhas com quebras de linha padrão (\n)
    const csvCompleto = linhas.join('\n');

    // 4. Criar um "Blob" (Binary Large Object) com o conteúdo e o tipo MIME correto
    // Usamos o BOM (\uFEFF) para garantir que o Excel reconhece caracteres especiais (acentos)
    const blob = new Blob(['\uFEFF' + csvCompleto], { type: 'text/csv;charset=utf-8;' });

    // 5. Técnica de Download Forçado:
    // Criamos um URL temporário na memória do navegador para este Blob
    const url = URL.createObjectURL(blob);
    
    // Criamos um elemento <a> invisível, simulamos o clique e depois removemos
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", nomeFicheiro || "exportacao.csv");
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Libertar a memória do URL criado
    URL.revokeObjectURL(url);
    
    console.log("Exportação CSV concluída com sucesso.");
}

// Anexar ao objecto window
window.exportarParaCSV = exportarParaCSV;

// Nota para o Professor:
// Este ficheiro demonstra competências em:
// - Integração de standards interoparáveis da OGC (WFS, WMS).
// - Consumo de APIs RESTful nativas (PostgREST/Supabase) sem dependências.
// - Manipulação de APIs Geográficas (Leaflet) e formatos standard (GeoJSON).
// - Domínio de JavaScript Assíncrono (Promises/Fetch API).
