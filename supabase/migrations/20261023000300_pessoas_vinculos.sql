-- =====================================================================
-- IDEALIZE RH 360º — Migração 003: colaboradores, vínculos, lotação, cargos, remuneração
-- =====================================================================
-- Regras:
--   * Um colaborador pode ter vários vínculos ao longo do tempo (readmissão),
--     mas só um vínculo em aberto por empresa.
--   * Status do vínculo só muda pela função alterar_status_vinculo (máquina de estados).
--   * Loja atual só muda pela função transferir_colaborador (gera histórico de lotação).
--   * Transferência entre CNPJs diferentes é bloqueada: exige processo próprio
--     (pendente de validação com a contabilidade).
--   * Nada é apagado: não existem políticas de DELETE.
-- =====================================================================

create type public.vinculo_status as enum (
  'pre_admissao', 'em_admissao', 'ativo', 'em_ferias', 'afastado',
  'em_licenca', 'em_desligamento', 'desligado', 'arquivado'
);

create type public.vinculo_tipo as enum (
  'clt_prazo_indeterminado', 'clt_experiencia', 'clt_prazo_determinado',
  'estagio', 'aprendiz', 'temporario', 'pj', 'autonomo'
);

-- ---------------------------------------------------------------------
-- Colaboradores (dados pessoais mínimos)
-- ---------------------------------------------------------------------
create table public.colaboradores (
  id              uuid primary key default gen_random_uuid(),
  nome_completo   text not null check (length(trim(nome_completo)) > 2),
  nome_social     text,
  cpf             text not null unique check (cpf ~ '^\d{11}$' and privado.cpf_valido(cpf)),
  data_nascimento date check (data_nascimento is null or data_nascimento between date '1920-01-01' and current_date),
  email           text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  telefone        text check (telefone is null or telefone ~ '^\d{10,11}$'),
  cep             text check (cep is null or cep ~ '^\d{8}$'),
  logradouro      text,
  numero          text,
  complemento     text,
  bairro          text,
  cidade          text,
  uf              char(2),
  loja_atual_id   uuid not null references public.lojas(id) on delete restrict,
  usuario_id      uuid unique references public.usuarios(id),
  criado_em       timestamptz not null default now(),
  criado_por      uuid references public.usuarios(id) default auth.uid(),
  atualizado_em   timestamptz not null default now()
);
create index on public.colaboradores (loja_atual_id);
create index colaboradores_nome_busca on public.colaboradores using gin (to_tsvector('portuguese', nome_completo || ' ' || coalesce(nome_social, '')));

alter table public.lojas
  add constraint lojas_responsavel_fk foreign key (responsavel_colaborador_id)
  references public.colaboradores(id) on delete set null;
alter table public.usuarios
  add constraint usuarios_colaborador_fk foreign key (colaborador_id)
  references public.colaboradores(id) on delete set null;

create table public.contatos_emergencia (
  id              uuid primary key default gen_random_uuid(),
  colaborador_id  uuid not null references public.colaboradores(id) on delete restrict,
  nome            text not null,
  parentesco      text,
  telefone        text not null check (telefone ~ '^\d{10,11}$'),
  criado_em       timestamptz not null default now()
);
create index on public.contatos_emergencia (colaborador_id);

-- ---------------------------------------------------------------------
-- Vínculos profissionais
-- ---------------------------------------------------------------------
create table public.vinculos (
  id                    uuid primary key default gen_random_uuid(),
  colaborador_id        uuid not null references public.colaboradores(id) on delete restrict,
  empresa_id            uuid not null references public.empresas(id) on delete restrict,
  matricula             text not null,
  tipo                  public.vinculo_tipo not null,
  status                public.vinculo_status not null default 'pre_admissao',
  data_admissao         date,
  data_desligamento     date,
  cargo_id              uuid references public.cargos(id),
  departamento_id       uuid references public.departamentos(id),
  gestor_colaborador_id uuid references public.colaboradores(id),
  jornada_semanal_horas numeric(4,1) check (jornada_semanal_horas is null or jornada_semanal_horas between 1 and 44),
  escala                text,
  criado_em             timestamptz not null default now(),
  criado_por            uuid references public.usuarios(id) default auth.uid(),
  atualizado_em         timestamptz not null default now(),
  unique (empresa_id, matricula),
  check (data_desligamento is null or data_admissao is null or data_desligamento >= data_admissao),
  check (status not in ('ativo','em_ferias','afastado','em_licenca','em_desligamento') or data_admissao is not null),
  check (status <> 'desligado' or data_desligamento is not null)
);
create unique index vinculos_um_aberto_por_empresa
  on public.vinculos (colaborador_id, empresa_id)
  where status not in ('desligado', 'arquivado');
create index on public.vinculos (colaborador_id);
create index on public.vinculos (status);

-- Máquina de estados configurável
create table public.status_transicoes (
  de        public.vinculo_status not null,
  para      public.vinculo_status not null,
  requisito text check (requisito is null or requisito in ('desligamento_concluido')),
  primary key (de, para)
);

create table public.vinculo_status_historico (
  id          bigint generated always as identity primary key,
  vinculo_id  uuid not null references public.vinculos(id) on delete restrict,
  de          public.vinculo_status,
  para        public.vinculo_status not null,
  motivo      text,
  data_efeito date not null default current_date,
  registrado_por uuid references public.usuarios(id) default auth.uid(),
  registrado_em  timestamptz not null default now()
);
create index on public.vinculo_status_historico (vinculo_id);

-- Processo de desligamento (estrutura mínima; fluxo completo na Etapa 2)
create table public.desligamentos (
  id                uuid primary key default gen_random_uuid(),
  vinculo_id        uuid not null unique references public.vinculos(id) on delete restrict,
  modalidade        text not null,
  data_comunicacao  date not null,
  data_desligamento date,
  status            text not null default 'em_andamento' check (status in ('em_andamento','concluido','cancelado')),
  observacoes       text,
  criado_por        uuid references public.usuarios(id) default auth.uid(),
  criado_em         timestamptz not null default now(),
  concluido_por     uuid references public.usuarios(id),
  concluido_em      timestamptz,
  check (status <> 'concluido' or (data_desligamento is not null and concluido_por is not null))
);

-- Histórico de lotação (loja)
create table public.lotacoes (
  id            uuid primary key default gen_random_uuid(),
  vinculo_id    uuid not null references public.vinculos(id) on delete restrict,
  loja_id       uuid not null references public.lojas(id) on delete restrict,
  inicio        date not null,
  fim           date,
  motivo        text,
  registrado_por uuid references public.usuarios(id) default auth.uid(),
  registrado_em  timestamptz not null default now(),
  check (fim is null or fim >= inicio)
);
create unique index lotacoes_uma_aberta on public.lotacoes (vinculo_id) where fim is null;
create index on public.lotacoes (loja_id);

-- Histórico de cargos (promoções / mudanças de função)
create table public.historico_cargos (
  id            uuid primary key default gen_random_uuid(),
  vinculo_id    uuid not null references public.vinculos(id) on delete restrict,
  cargo_id      uuid not null references public.cargos(id),
  inicio        date not null,
  fim           date,
  tipo          text not null default 'mudanca_funcao' check (tipo in ('admissao','promocao','mudanca_funcao','correcao')),
  motivo        text,
  registrado_por uuid references public.usuarios(id) default auth.uid(),
  registrado_em  timestamptz not null default now()
);
create unique index historico_cargos_um_aberto on public.historico_cargos (vinculo_id) where fim is null;

-- Remuneração (tabela separada, acesso restrito)
create table public.remuneracoes (
  id              uuid primary key default gen_random_uuid(),
  vinculo_id      uuid not null references public.vinculos(id) on delete restrict,
  salario_base    numeric(12,2) not null check (salario_base > 0),
  vigencia_inicio date not null,
  motivo          text not null,
  origem          text not null default 'manual' check (origem in ('manual','folha')),
  origem_atualizada_em timestamptz,
  registrado_por  uuid references public.usuarios(id) default auth.uid(),
  registrado_em   timestamptz not null default now(),
  unique (vinculo_id, vigencia_inicio)
);

create trigger colaboradores_atualizado before update on public.colaboradores
  for each row execute function privado.tocar_atualizado_em();
create trigger vinculos_atualizado before update on public.vinculos
  for each row execute function privado.tocar_atualizado_em();

-- ---------------------------------------------------------------------
-- Travas: status e loja só mudam pelas funções oficiais
-- ---------------------------------------------------------------------
create or replace function privado.travar_status_vinculo()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('idealize.via_funcao', true), '') <> 'status' then
    raise exception 'Status do vínculo só pode ser alterado por alterar_status_vinculo()' using errcode = '42501';
  end if;
  if (new.colaborador_id, new.empresa_id) is distinct from (old.colaborador_id, old.empresa_id) then
    raise exception 'Colaborador e empresa do vínculo não podem ser alterados' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger vinculos_trava before update on public.vinculos
  for each row execute function privado.travar_status_vinculo();

create or replace function privado.travar_loja_colaborador()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.loja_atual_id is distinct from old.loja_atual_id
     and coalesce(current_setting('idealize.via_funcao', true), '') <> 'transferencia' then
    raise exception 'Loja só pode ser alterada por transferir_colaborador()' using errcode = '42501';
  end if;
  if new.cpf is distinct from old.cpf
     and not privado.pode('colaborador.dados_pessoais.editar', old.loja_atual_id) then
    raise exception 'Sem permissão para alterar CPF' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger colaboradores_trava before update on public.colaboradores
  for each row execute function privado.travar_loja_colaborador();

-- Helper: loja atual de um vínculo / colaborador
create or replace function privado.loja_do_colaborador(p_colaborador uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select loja_atual_id from public.colaboradores where id = p_colaborador;
$$;
create or replace function privado.loja_do_vinculo(p_vinculo uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select c.loja_atual_id from public.vinculos v join public.colaboradores c on c.id = v.colaborador_id
   where v.id = p_vinculo;
$$;
grant execute on function privado.loja_do_colaborador(uuid) to authenticated;
grant execute on function privado.loja_do_vinculo(uuid) to authenticated;
