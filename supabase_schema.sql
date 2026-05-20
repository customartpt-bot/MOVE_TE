-- Habilita PostGIS para suporte geoespacial
CREATE EXTENSION IF NOT EXISTS postgis;

-- Tabela de Freguesias (CAOP Almada)
CREATE TABLE freguesias (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    geom GEOMETRY(MultiPolygon, 4326)
);

-- Tabela de Clubes/Entidades
CREATE TABLE clubes (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    morada TEXT,
    website TEXT,
    geom GEOMETRY(Point, 4326),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabela de Modalidades
CREATE TABLE modalidades (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) UNIQUE NOT NULL
);

-- Tabela de Oferta Desportiva (Ligação Clube-Modalidade com Horários e Preços)
CREATE TABLE oferta_desportiva (
    id SERIAL PRIMARY KEY,
    clube_id INTEGER REFERENCES clubes(id) ON DELETE CASCADE,
    modalidade_id INTEGER REFERENCES modalidades(id) ON DELETE CASCADE,
    horario TEXT, -- Ex: "Seg e Qua 18h-19h"
    mensalidade NUMERIC(10, 2), -- Preço em Euros
    idade_min INTEGER,
    idade_max INTEGER,
    observacoes TEXT
);

-- RLS (Row Level Security) - Permitir leitura pública
ALTER TABLE freguesias ENABLE ROW LEVEL SECURITY;
ALTER TABLE clubes ENABLE ROW LEVEL SECURITY;
ALTER TABLE modalidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE oferta_desportiva ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON freguesias FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON clubes FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON modalidades FOR SELECT USING (true);
CREATE POLICY "Allow public read" ON oferta_desportiva FOR SELECT USING (true);

-- Índices Espaciais
CREATE INDEX idx_freguesias_geom ON freguesias USING GIST (geom);
CREATE INDEX idx_clubes_geom ON clubes USING GIST (geom);

-- View para facilitar consultas da IA (Flattened Data)
CREATE OR REPLACE VIEW v_oferta_completa AS
SELECT 
    o.id as oferta_id,
    c.nome as clube_nome,
    c.morada as clube_morada,
    m.nome as modalidade_nome,
    o.horario,
    o.mensalidade,
    f.nome as freguesia_nome,
    c.geom as clube_localizacao
FROM oferta_desportiva o
JOIN clubes c ON o.clube_id = c.id
JOIN modalidades m ON o.modalidade_id = m.id
LEFT JOIN freguesias f ON ST_Intersects(c.geom, f.geom);
