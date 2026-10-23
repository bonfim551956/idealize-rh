-- =====================================================================
-- IDEALIZE RH 360º — Migração 004: auditoria, linha do tempo, tarefas
-- =====================================================================

-- ---------------------------------------------------------------------
-- Auditoria (append-only)
-- ---------------------------------------------------------------------
create table public.audit_log (
  id            bigint generated always as identity primary key,
  em            timestamptz not null default now(),
  usuario_id    uuid default auth.uid(),
  acao          text not null,             -- INSERT / UPDATE / DELETE / evento nomeado
  tabela        text,
  registro_id   text,
  loja_id       uuid,
  resultado     text not null default 'sucesso' check (resultado in ('sucesso','negado','erro')),
  dados_antes   jsonb,
  dados_depois  jsonb,
  contexto      jsonb
);
create index on public.audit_log (tabela, registro_id);
create index on public.audit_log (usuario_id, em desc);
create index on public.audit_log (em desc);

create or replace function privado.bloquear_alteracao_audit()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Registros de auditoria não podem ser alterados nem excluídos' using errcode = '42501';
end $$;
create trigger audit_log_imutavel before update or delete on public.audit_log
  for each row execute function privado.bloquear_alteracao_audit();
create trigger audit_log_sem_truncate before truncate on public.audit_log
  for each statement execute function privado.bloquear_alteracao_audit();

-- Remove do JSON campos que nunca devem ir para o log
create or replace function privado.limpar_segredos(p jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select p - 'senha' - 'password' - 'token' - 'access_token' - 'refresh_token' - 'encrypted_password';
$$;

create or replace function privado.registrar_evento(
  p_acao text, p_tabela text, p_registro text, p_loja uuid,
  p_contexto jsonb default null, p_resultado text default 'sucesso')
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (acao, tabela, registro_id, loja_id, contexto, resultado)
  values (p_acao, p_tabela, p_registro, p_loja, privado.limpar_segredos(p_contexto), p_resultado);
$$;

-- Trigger genérico de auditoria
create or replace function privado.auditar()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_antes  jsonb := case when tg_op in ('UPDATE','DELETE') then privado.limpar_segredos(to_jsonb(old)) end;
  v_depois jsonb := case when tg_op in ('INSERT','UPDATE') then privado.limpar_segredos(to_jsonb(new)) end;
  v_reg    jsonb := coalesce(v_depois, v_antes);
  v_loja   uuid;
begin
  v_loja := coalesce(
    nullif(v_reg ->> 'loja_id', '')::uuid,
    nullif(v_reg ->> 'loja_atual_id', '')::uuid,
    case when v_reg ? 'vinculo_id' then privado.loja_do_vinculo((v_reg ->> 'vinculo_id')::uuid) end,
    case when v_reg ? 'colaborador_id' then privado.loja_do_colaborador((v_reg ->> 'colaborador_id')::uuid) end
  );
  -- em UPDATE guarda só o que mudou
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(k, v_antes -> k), '{}'::jsonb),
           coalesce(jsonb_object_agg(k, v_depois -> k), '{}'::jsonb)
      into v_antes, v_depois
      from jsonb_object_keys(v_depois) k
     where (v_antes -> k) is distinct from (v_depois -> k) and k <> 'atualizado_em';
    if v_depois = '{}'::jsonb then return new; end if;
  end if;
  insert into public.audit_log (acao, tabela, registro_id, loja_id, dados_antes, dados_depois)
  values (tg_op, tg_table_name, v_reg ->> 'id', v_loja, v_antes, v_depois);
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------
-- Linha do tempo do colaborador
-- ---------------------------------------------------------------------
create table public.eventos_timeline (
  id              uuid primary key default gen_random_uuid(),
  colaborador_id  uuid not null references public.colaboradores(id) on delete restrict,
  vinculo_id      uuid references public.vinculos(id) on delete restrict,
  tipo            text not null,
  data_evento     date not null,
  titulo          text not null,
  descricao       text,
  sigilo          text not null default 'geral'
                  check (sigilo in ('geral','pessoal','contratual','saude','financeiro','disciplinar','juridico')),
  documento_id    uuid,   -- FK na migração de documentos
  origem          text not null default 'sistema' check (origem in ('sistema','manual','integracao')),
  registrado_por  uuid references public.usuarios(id) default auth.uid(),
  registrado_em   timestamptz not null default now()
);
create index on public.eventos_timeline (colaborador_id, data_evento desc);

create or replace function privado.timeline(
  p_colaborador uuid, p_vinculo uuid, p_tipo text, p_data date, p_titulo text,
  p_descricao text default null, p_sigilo text default 'geral', p_documento uuid default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.eventos_timeline (colaborador_id, vinculo_id, tipo, data_evento, titulo, descricao, sigilo, documento_id)
  values (p_colaborador, p_vinculo, p_tipo, p_data, p_titulo, p_descricao, p_sigilo, p_documento);
$$;

-- Mapeia nível de sigilo -> permissão de leitura
create or replace function privado.pode_sigilo(p_sigilo text, p_loja uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_sigilo
    when 'geral'       then privado.pode('colaborador.ler', p_loja)
    when 'financeiro'  then privado.pode('remuneracao.ler', p_loja) or privado.pode('documento.financeiro.ler', p_loja)
    else privado.pode('documento.' || p_sigilo || '.ler', p_loja)
  end;
$$;
grant execute on function privado.pode_sigilo(text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Central de tarefas
-- ---------------------------------------------------------------------
create table public.tarefas (
  id              uuid primary key default gen_random_uuid(),
  titulo          text not null,
  descricao       text,
  categoria       text not null default 'geral',
  colaborador_id  uuid references public.colaboradores(id) on delete restrict,
  loja_id         uuid references public.lojas(id) on delete restrict,
  responsavel_id  uuid references public.usuarios(id),
  prazo           date,
  prioridade      text not null default 'normal' check (prioridade in ('baixa','normal','alta','critica')),
  status          text not null default 'aberta' check (status in ('aberta','em_andamento','concluida','cancelada')),
  origem          text not null default 'manual' check (origem in ('manual','sistema')),
  chave_dedup     text unique,   -- evita alertas duplicados gerados pelo sistema
  criado_por      uuid references public.usuarios(id) default auth.uid(),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  concluida_por   uuid references public.usuarios(id),
  concluida_em    timestamptz,
  check (status <> 'concluida' or concluida_em is not null)
);
create index on public.tarefas (loja_id, status);
create index on public.tarefas (responsavel_id, status);
create trigger tarefas_atualizado before update on public.tarefas
  for each row execute function privado.tocar_atualizado_em();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.audit_log         enable row level security;
alter table public.eventos_timeline  enable row level security;
alter table public.tarefas           enable row level security;

create policy audit_ler on public.audit_log for select to authenticated
  using (privado.pode('auditoria.ler'));
revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;

create policy timeline_ler on public.eventos_timeline for select to authenticated
  using (privado.pode_sigilo(sigilo, privado.loja_do_colaborador(colaborador_id)));
revoke insert, update, delete on public.eventos_timeline from anon, authenticated;

create policy tarefas_ler on public.tarefas for select to authenticated
  using (responsavel_id = auth.uid()
         or (loja_id is not null and privado.pode('tarefa.ler', loja_id))
         or (loja_id is null and privado.pode('tarefa.ler')));
create policy tarefas_criar on public.tarefas for insert to authenticated
  with check (origem = 'manual'
              and ((loja_id is not null and privado.pode('tarefa.gerir', loja_id))
                   or (loja_id is null and privado.pode('tarefa.gerir'))));
create policy tarefas_editar on public.tarefas for update to authenticated
  using (responsavel_id = auth.uid()
         or (loja_id is not null and privado.pode('tarefa.gerir', loja_id))
         or (loja_id is null and privado.pode('tarefa.gerir')))
  with check (responsavel_id = auth.uid()
         or (loja_id is not null and privado.pode('tarefa.gerir', loja_id))
         or (loja_id is null and privado.pode('tarefa.gerir')));

-- ---------------------------------------------------------------------
-- Auditoria nas tabelas já existentes
-- ---------------------------------------------------------------------
create trigger auditar after insert or update or delete on public.empresas            for each row execute function privado.auditar();
create trigger auditar after insert or update or delete on public.lojas               for each row execute function privado.auditar();
create trigger auditar after insert or update or delete on public.cargos              for each row execute function privado.auditar();
create trigger auditar after insert or update or delete on public.usuarios            for each row execute function privado.auditar();
create trigger auditar after insert or update or delete on public.perfil_permissoes   for each row execute function privado.auditar();
create trigger auditar after insert or update or delete on public.usuario_atribuicoes for each row execute function privado.auditar();
create trigger auditar after insert or update or delete on public.colaboradores       for each row execute function privado.auditar();
create trigger auditar after insert or update or delete on public.vinculos            for each row execute function privado.auditar();
create trigger auditar after insert or update or delete on public.lotacoes            for each row execute function privado.auditar();
create trigger auditar after insert or update or delete on public.historico_cargos    for each row execute function privado.auditar();
create trigger auditar after insert or update or delete on public.remuneracoes        for each row execute function privado.auditar();
create trigger auditar after insert or update or delete on public.desligamentos       for each row execute function privado.auditar();
create trigger auditar after insert or update or delete on public.contatos_emergencia for each row execute function privado.auditar();
create trigger auditar after insert or update or delete on public.tarefas             for each row execute function privado.auditar();
