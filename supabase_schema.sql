-- Habilita PostGIS para suporte geoespacial
CREATE EXTENSION IF NOT EXISTS postgis;

-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.DESP_CLUBE_MODALIDADE (
  id character varying NOT NULL,
  id_clube bigint,
  id_modalidade bigint,
  mensalidade character varying,
  CONSTRAINT DESP_CLUBE_MODALIDADE_pkey PRIMARY KEY (id),
  CONSTRAINT DESP_CLUBE_MODALIDADE_id_clube_fkey FOREIGN KEY (id_clube) REFERENCES public.Entidades_Desportivas(id),
  CONSTRAINT DESP_CLUBE_MODALIDADE_id_modalidade_fkey FOREIGN KEY (id_modalidade) REFERENCES public.DESP_MODALIDADE(id_modalidade)
);
CREATE TABLE public.DESP_MODALIDADE (
  id bigint NOT NULL,
  id_modalidade bigint NOT NULL UNIQUE,
  modalidade character varying,
  categoria character varying,
  CONSTRAINT DESP_MODALIDADE_pkey PRIMARY KEY (id_modalidade)
);
CREATE TABLE public.Entidades_Desportivas (
  id bigint NOT NULL,
  geom USER-DEFINED,
  nome_clube character varying,
  morada character varying,
  freguesia bigint,
  localidade bigint,
  cod_postal character varying,
  email character varying,
  website character varying,
  telefone character varying,
  latitude numeric,
  longitude numeric,
  observacoe character varying,
  dataregist date,
  registadop character varying,
  dataatuali date NOT NULL,
  atualizado character varying NOT NULL,
  CONSTRAINT Entidades_Desportivas_pkey PRIMARY KEY (id)
);
CREATE TABLE public.Limite_Concelho_WGS84 (
  id bigint NOT NULL,
  geom USER-DEFINED,
  data_criac date,
  cod_conc_i character varying,
  area_digit numeric,
  data_digit date,
  html character varying,
  imagem character varying,
  som character varying,
  video character varying,
  cad character varying,
  documentos character varying,
  designacao character varying,
  login character varying,
  CONSTRAINT Limite_Concelho_WGS84_pkey PRIMARY KEY (id)
);
CREATE TABLE public.Limite_UniaoFreguesias_WGS84 (
  id integer NOT NULL DEFAULT nextval('"Limite_UniaoFreguesias_WGS84_id_seq"'::regclass),
  geom USER-DEFINED,
  designacao character varying,
  sede character varying,
  dicofre character varying,
  area_digit numeric,
  data_criac character varying,
  desig_simp character varying,
  id1 bigint,
  login character varying,
  cod_freg character varying,
  CONSTRAINT Limite_UniaoFreguesias_WGS84_pkey PRIMARY KEY (id)
);
CREATE TABLE public.Limites_Freguesia_WGS84 (
  id bigint NOT NULL,
  geom USER-DEFINED,
  designacao character varying,
  cod_freg_i character varying,
  area_digit numeric,
  data_digit date,
  html character varying,
  imagem character varying,
  som character varying,
  video character varying,
  cad character varying,
  documentos character varying,
  cod_freg bigint,
  data_criac character varying,
  login character varying,
  iduniaofre integer,
  CONSTRAINT Limites_Freguesia_WGS84_pkey PRIMARY KEY (id)
);
CREATE TABLE public.spatial_ref_sys (
  srid integer NOT NULL CHECK (srid > 0 AND srid <= 998999),
  auth_name character varying,
  auth_srid integer,
  srtext character varying,
  proj4text character varying,
  CONSTRAINT spatial_ref_sys_pkey PRIMARY KEY (srid)
);