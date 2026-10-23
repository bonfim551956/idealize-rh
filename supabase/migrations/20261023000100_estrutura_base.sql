-- =====================================================================
-- IDEALIZE RH 360º — Migração 001: estrutura base (empresas, lojas, cargos)
-- =====================================================================
-- Empresa = empregador legal (CNPJ). Loja = unidade operacional.
-- O vínculo CLT é sempre com a empresa; a loja é a lotação.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- Schema privado para funções internas (não exposto pela API REST)
create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;
grant usage on schema privado to authenticated;

-- ---------------------------------------------------------------------
-- Utilitários
-- ---------------------------------------------------------------------
create or replace function privado.so_digitos(p text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(coalesce(p, ''), '\D', '', 'g');
$$;

create or replace function privado.cnpj_valido(p text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  c text := privado.so_digitos(p);
  pesos1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  pesos2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  soma int; resto int; dv1 int; dv2 int;
begin
  if length(c) <> 14 or c ~ '^(\d)\1{13}$' then return false; end if;
  soma := 0;
  for i in 1..12 loop soma := soma + substr(c, i, 1)::int * pesos1[i]; end loop;
  resto := soma % 11; dv1 := case when resto < 2 then 0 else 11 - resto end;
  soma := 0;
  for i in 1..13 loop soma := soma + substr(c, i, 1)::int * pesos2[i]; end loop;
  resto := soma % 11; dv2 := case when resto < 2 then 0 else 11 - resto end;
  return dv1 = substr(c, 13, 1)::int and dv2 = substr(c, 14, 1)::int;
end $$;

create or replace function privado.cpf_valido(p text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  c text := privado.so_digitos(p);
  soma int; resto int; dv1 int; dv2 int;
begin
  if length(c) <> 11 or c ~ '^(\d)\1{10}$' then return false; end if;
  soma := 0;
  for i in 1..9 loop soma := soma + substr(c, i, 1)::int * (11 - i); end loop;
  resto := (soma * 10) % 11; dv1 := case when resto = 10 then 0 else resto end;
  soma := 0;
  for i in 1..10 loop soma := soma + substr(c, i, 1)::int * (12 - i); end loop;
  resto := (soma * 10) % 11; dv2 := case when resto = 10 then 0 else resto end;
  return dv1 = substr(c, 10, 1)::int and dv2 = substr(c, 11, 1)::int;
end $$;

create or replace function privado.tocar_atualizado_em()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Empresas (empregadores)
-- ---------------------------------------------------------------------
create table public.empresas (
  id              uuid primary key default gen_random_uuid(),
  cnpj            text not null unique
                  check (cnpj ~ '^\d{14}$' and privado.cnpj_valido(cnpj)),
  razao_social    text not null check (length(trim(razao_social)) > 1),
  nome_fantasia   text,
  dados_confirmados boolean not null default false,
  observacao      text,
  ativa           boolean not null default true,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
comment on table public.empresas is 'Empregador legal (CNPJ). Vínculos CLT são com a empresa.';
comment on column public.empresas.dados_confirmados is 'false = dado provisório, precisa ser conferido por usuário autorizado';

-- ---------------------------------------------------------------------
-- Lojas (unidades)
-- ---------------------------------------------------------------------
create table public.lojas (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas(id) on delete restrict,
  codigo          text not null unique check (codigo ~ '^[A-Z0-9_-]{2,20}$'),
  nome            text not null check (length(trim(nome)) > 1),
  cidade          text,
  uf              char(2),
  endereco        text,
  cep             text check (cep is null or cep ~ '^\d{8}$'),
  telefone        text,
  responsavel_colaborador_id uuid,  -- FK adicionada após criar colaboradores
  ativa           boolean not null default true,
  dados_confirmados boolean not null default false,
  observacao      text,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create index on public.lojas (empresa_id);

-- ---------------------------------------------------------------------
-- Cargos e departamentos (configuráveis; podem ser restritos a lojas)
-- ---------------------------------------------------------------------
create table public.departamentos (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null unique,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now()
);

create table public.cargos (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null unique,
  cbo           text check (cbo is null or cbo ~ '^\d{4}-?\d{2}$'),
  descricao     text,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create trigger empresas_atualizado before update on public.empresas
  for each row execute function privado.tocar_atualizado_em();
create trigger lojas_atualizado before update on public.lojas
  for each row execute function privado.tocar_atualizado_em();
create trigger cargos_atualizado before update on public.cargos
  for each row execute function privado.tocar_atualizado_em();

-- RLS ligada desde a criação (políticas na migração 002)
alter table public.empresas enable row level security;
alter table public.lojas enable row level security;
alter table public.cargos enable row level security;
alter table public.departamentos enable row level security;
