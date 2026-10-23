-- =====================================================================
-- IDEALIZE RH 360º — Migração 006: gestão documental
-- =====================================================================
-- Arquivos ficam no bucket PRIVADO "documentos" (sem nenhuma política de
-- acesso direto para usuários). Upload e download passam por Edge Functions
-- que chamam as funções abaixo com o JWT do usuário (RLS + permissão) e só
-- então usam a chave de serviço para gravar / gerar URL assinada de 60 s.
-- =====================================================================

create type public.documento_status as enum (
  'nao_solicitado', 'pendente', 'recebido', 'em_conferencia', 'aprovado',
  'reprovado', 'aguardando_assinatura', 'assinado', 'vencido', 'arquivado'
);

create table public.doc_categorias (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text not null unique check (codigo ~ '^[a-z_]{3,40}$'),
  nome                text not null,
  nivel_sigilo        text not null
                      check (nivel_sigilo in ('geral','pessoal','contratual','saude','financeiro','disciplinar','juridico')),
  exige_vencimento    boolean not null default false,
  exige_competencia   boolean not null default false,
  retencao_anos       int check (retencao_anos is null or retencao_anos > 0),
  retencao_base       text check (retencao_base is null or retencao_base in ('emissao','desligamento','vencimento')),
  retencao_validada   boolean not null default false,   -- false = parâmetro provisório, sem validação jurídica
  retencao_observacao text,
  ativa               boolean not null default true,
  criado_em           timestamptz not null default now()
);

create table public.documentos (
  id                  uuid primary key default gen_random_uuid(),
  nome                text not null check (length(trim(nome)) > 1),
  categoria_id        uuid not null references public.doc_categorias(id),
  colaborador_id      uuid references public.colaboradores(id) on delete restrict,
  loja_id             uuid not null references public.lojas(id) on delete restrict,
  data_emissao        date,
  data_recebimento    date,
  competencia         date check (competencia is null or extract(day from competencia) = 1),
  periodo_inicio      date,
  periodo_fim         date,
  vencimento          date,
  status              public.documento_status not null default 'pendente',
  status_assinatura   text not null default 'nao_aplicavel'
                      check (status_assinatura in ('nao_aplicavel','pendente','assinado','recusado')),
  versao_atual        int not null default 0,
  enviado_por         uuid references public.usuarios(id),
  conferido_por       uuid references public.usuarios(id),
  conferido_em        timestamptz,
  observacoes         text,
  criado_por          uuid references public.usuarios(id) default auth.uid(),
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  check (periodo_fim is null or periodo_inicio is null or periodo_fim >= periodo_inicio),
  check (status not in ('aprovado','reprovado') or (conferido_por is not null and conferido_em is not null))
);
create index on public.documentos (loja_id, status);
create index on public.documentos (colaborador_id);
create index on public.documentos (categoria_id);
create index on public.documentos (vencimento) where vencimento is not null;
create index documentos_nome_busca on public.documentos using gin (to_tsvector('portuguese', nome));

create table public.documento_versoes (
  id                    uuid primary key default gen_random_uuid(),
  documento_id          uuid not null references public.documentos(id) on delete restrict,
  versao                int not null check (versao > 0),
  storage_path          text not null unique,
  nome_arquivo_original text not null,
  mime_type             text not null check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  tamanho_bytes         bigint not null check (tamanho_bytes > 0 and tamanho_bytes <= 20971520),
  sha256                text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  confirmado            boolean not null default false,   -- true só depois que o arquivo foi gravado no storage
  motivo_substituicao   text,
  enviado_por           uuid references public.usuarios(id) default auth.uid(),
  enviado_em            timestamptz not null default now(),
  unique (documento_id, versao)
);

create table public.documento_acessos (
  id            bigint generated always as identity primary key,
  documento_id  uuid not null references public.documentos(id) on delete restrict,
  versao_id     uuid references public.documento_versoes(id),
  usuario_id    uuid default auth.uid(),
  acao          text not null check (acao in ('visualizar','download')),
  em            timestamptz not null default now()
);
create index on public.documento_acessos (documento_id, em desc);

alter table public.eventos_timeline
  add constraint eventos_timeline_documento_fk foreign key (documento_id) references public.documentos(id);

create trigger documentos_atualizado before update on public.documentos
  for each row execute function privado.tocar_atualizado_em();
create trigger auditar after insert or update or delete on public.doc_categorias    for each row execute function privado.auditar();
create trigger auditar after insert or update or delete on public.documentos        for each row execute function privado.auditar();
create trigger auditar after insert or update or delete on public.documento_versoes for each row execute function privado.auditar();

-- ---------------------------------------------------------------------
-- Autorização por sigilo da categoria
-- ---------------------------------------------------------------------
create or replace function privado.pode_documento(p_acao text, p_categoria uuid, p_loja uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select privado.pode('documento.' || c.nivel_sigilo || '.' || p_acao, p_loja)
       from public.doc_categorias c where c.id = p_categoria), false);
$$;
grant execute on function privado.pode_documento(text, uuid, uuid) to authenticated;

-- Status de aprovação só pela função de conferência
create or replace function privado.travar_documento()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('idealize.via_funcao', true), '') <> 'documento' then
    if new.status is distinct from old.status
       or new.conferido_por is distinct from old.conferido_por
       or new.versao_atual is distinct from old.versao_atual
       or new.loja_id is distinct from old.loja_id
       or new.colaborador_id is distinct from old.colaborador_id
       or new.categoria_id is distinct from old.categoria_id then
      raise exception 'Status, versão, loja, colaborador e categoria do documento só mudam pelas funções próprias'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger documentos_trava before update on public.documentos
  for each row execute function privado.travar_documento();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.doc_categorias    enable row level security;
alter table public.documentos        enable row level security;
alter table public.documento_versoes enable row level security;
alter table public.documento_acessos enable row level security;

create policy categorias_ler on public.doc_categorias for select to authenticated
  using (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo));
create policy categorias_ins on public.doc_categorias for insert to authenticated
  with check (privado.pode('config.estrutura.gerir'));
create policy categorias_upd on public.doc_categorias for update to authenticated
  using (privado.pode('config.estrutura.gerir')) with check (privado.pode('config.estrutura.gerir'));

create policy documentos_ler on public.documentos for select to authenticated
  using (privado.pode_documento('ler', categoria_id, loja_id));
-- edição de metadados livres (nome, datas, observações); campos críticos travados pelo trigger
create policy documentos_editar on public.documentos for update to authenticated
  using (privado.pode_documento('enviar', categoria_id, loja_id))
  with check (privado.pode_documento('enviar', categoria_id, loja_id));

create policy versoes_ler on public.documento_versoes for select to authenticated
  using (exists (select 1 from public.documentos d
                  where d.id = documento_id and privado.pode_documento('ler', d.categoria_id, d.loja_id)));
create policy acessos_ler on public.documento_acessos for select to authenticated
  using (privado.pode('auditoria.ler'));

revoke insert, delete on public.documentos from anon, authenticated;
revoke insert, update, delete on public.documento_versoes, public.documento_acessos from anon, authenticated;

-- ---------------------------------------------------------------------
-- Upload em duas fases (chamado pela Edge Function com o JWT do usuário)
--   1) documento_preparar_upload  -> valida permissão, cria registro e devolve caminho
--   2) [Edge Function grava o arquivo no storage]
--   3) documento_confirmar_upload -> marca versão como confirmada e documento como "recebido"
-- Versões não confirmadas em 24 h são descartadas por rotina agendada (Etapa 2).
-- ---------------------------------------------------------------------
create or replace function public.documento_preparar_upload(
  p_documento uuid,           -- NULL = novo documento; preenchido = nova versão
  p_meta jsonb,               -- nome, categoria_id, colaborador_id, loja_id, datas...
  p_nome_arquivo text, p_mime text, p_tamanho bigint, p_sha256 text, p_motivo text default null)
returns table (documento_id uuid, versao_id uuid, versao int, storage_path text)
language plpgsql security definer set search_path = '' as $$
declare
  v_doc public.documentos%rowtype;
  v_loja uuid; v_cat uuid; v_col uuid; v_emp uuid; v_versao int; v_vid uuid; v_path text;
begin
  if p_documento is null then
    v_cat := (p_meta ->> 'categoria_id')::uuid;
    v_col := (privado.texto(p_meta, 'colaborador_id'))::uuid;
    v_loja := coalesce((privado.texto(p_meta, 'loja_id'))::uuid, privado.loja_do_colaborador(v_col));
    if v_cat is null or v_loja is null then raise exception 'Informe categoria e loja (ou colaborador)'; end if;
    if v_col is not null and privado.loja_do_colaborador(v_col) is distinct from v_loja then
      raise exception 'A loja do documento deve ser a loja atual do colaborador';
    end if;
    if not privado.pode_documento('enviar', v_cat, v_loja) then
      -- sem erro para não desfazer o registro da tentativa; a Edge Function responde 403
      perform privado.registrar_evento('UPLOAD_DOCUMENTO', 'documentos', null, v_loja,
        jsonb_build_object('categoria_id', v_cat), 'negado');
      return;
    end if;
    if exists (select 1 from public.doc_categorias c where c.id = v_cat and c.exige_competencia)
       and privado.texto(p_meta, 'competencia') is null then
      raise exception 'Esta categoria exige a competência (mês de referência)';
    end if;
    if exists (select 1 from public.doc_categorias c where c.id = v_cat and c.exige_vencimento)
       and privado.texto(p_meta, 'vencimento') is null then
      raise exception 'Esta categoria exige data de vencimento';
    end if;

    insert into public.documentos (nome, categoria_id, colaborador_id, loja_id, data_emissao, data_recebimento,
        competencia, periodo_inicio, periodo_fim, vencimento, status_assinatura, observacoes, enviado_por, status)
    values (coalesce(privado.texto(p_meta, 'nome'), p_nome_arquivo), v_cat, v_col, v_loja,
        (privado.texto(p_meta, 'data_emissao'))::date, coalesce((privado.texto(p_meta, 'data_recebimento'))::date, current_date),
        date_trunc('month', (privado.texto(p_meta, 'competencia'))::date)::date,
        (privado.texto(p_meta, 'periodo_inicio'))::date, (privado.texto(p_meta, 'periodo_fim'))::date,
        (privado.texto(p_meta, 'vencimento'))::date,
        coalesce(privado.texto(p_meta, 'status_assinatura'), 'nao_aplicavel'),
        privado.texto(p_meta, 'observacoes'), auth.uid(), 'pendente')
    returning * into v_doc;
  else
    select * into v_doc from public.documentos where id = p_documento for update;
    if v_doc.id is null then raise exception 'Documento não encontrado'; end if;
    if not privado.pode_documento('enviar', v_doc.categoria_id, v_doc.loja_id) then
      raise exception 'Sem permissão para substituir este documento' using errcode = '42501';
    end if;
    if v_doc.status = 'arquivado' then raise exception 'Documento arquivado não recebe novas versões'; end if;
    if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da substituição'; end if;
  end if;

  select coalesce(max(dv.versao), 0) + 1 into v_versao from public.documento_versoes dv where dv.documento_id = v_doc.id;
  select l.empresa_id into v_emp from public.lojas l where l.id = v_doc.loja_id;
  v_path := v_emp::text || '/' || coalesce(v_doc.colaborador_id::text, 'loja-' || v_doc.loja_id::text)
            || '/' || v_doc.id::text || '/v' || v_versao::text || '-' || gen_random_uuid()::text;

  insert into public.documento_versoes (documento_id, versao, storage_path, nome_arquivo_original,
      mime_type, tamanho_bytes, sha256, motivo_substituicao)
  values (v_doc.id, v_versao, v_path, p_nome_arquivo, p_mime, p_tamanho, lower(p_sha256), p_motivo)
  returning id into v_vid;

  return query select v_doc.id, v_vid, v_versao, v_path;
end $$;

create or replace function public.documento_confirmar_upload(p_versao uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  select dv.*, d.categoria_id, d.loja_id, d.colaborador_id, d.nome as doc_nome, c.nivel_sigilo
    into v
    from public.documento_versoes dv
    join public.documentos d on d.id = dv.documento_id
    join public.doc_categorias c on c.id = d.categoria_id
   where dv.id = p_versao;
  if v.id is null then raise exception 'Versão não encontrada'; end if;
  if v.confirmado then raise exception 'Versão já confirmada'; end if;
  if v.enviado_por is distinct from auth.uid() then raise exception 'Somente quem iniciou o envio pode confirmá-lo' using errcode = '42501'; end if;
  if not privado.pode_documento('enviar', v.categoria_id, v.loja_id) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;

  update public.documento_versoes set confirmado = true where id = p_versao;
  perform set_config('idealize.via_funcao', 'documento', true);
  -- nova versão volta para "recebido": precisa de nova conferência
  update public.documentos
     set versao_atual = v.versao, status = 'recebido', conferido_por = null, conferido_em = null,
         enviado_por = auth.uid()
   where id = v.documento_id;
  perform set_config('idealize.via_funcao', '', true);

  if v.colaborador_id is not null then
    perform privado.timeline(v.colaborador_id, null, 'documento', current_date,
      case when v.versao = 1 then 'Documento recebido: ' else 'Nova versão (v' || v.versao || '): ' end || v.doc_nome,
      null, v.nivel_sigilo, v.documento_id);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Conferência: enviado ≠ aprovado
-- ---------------------------------------------------------------------
create or replace function public.documento_conferir(p_documento uuid, p_aprovado boolean, p_observacao text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare v public.documentos%rowtype;
begin
  select * into v from public.documentos where id = p_documento for update;
  if v.id is null then raise exception 'Documento não encontrado'; end if;
  perform privado.exigir('documento.conferir', v.loja_id);
  if not privado.pode_documento('ler', v.categoria_id, v.loja_id) then
    raise exception 'Sem permissão para ler esta categoria' using errcode = '42501';
  end if;
  if v.status not in ('recebido', 'em_conferencia') then
    raise exception 'Só documentos recebidos ou em conferência podem ser conferidos (status atual: %)', v.status;
  end if;
  if v.versao_atual = 0 then raise exception 'Documento sem arquivo confirmado'; end if;
  if not p_aprovado and coalesce(trim(p_observacao), '') = '' then
    raise exception 'Informe o motivo da reprovação';
  end if;
  perform set_config('idealize.via_funcao', 'documento', true);
  update public.documentos
     set status = case when p_aprovado then 'aprovado' else 'reprovado' end::public.documento_status,
         conferido_por = auth.uid(), conferido_em = now(),
         observacoes = coalesce(nullif(trim(p_observacao), ''), observacoes)
   where id = p_documento;
  perform set_config('idealize.via_funcao', '', true);
end $$;

create or replace function public.documento_arquivar(p_documento uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v public.documentos%rowtype;
begin
  select * into v from public.documentos where id = p_documento for update;
  if v.id is null then raise exception 'Documento não encontrado'; end if;
  perform privado.exigir('documento.arquivar', v.loja_id);
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo'; end if;
  perform set_config('idealize.via_funcao', 'documento', true);
  update public.documentos set status = 'arquivado',
         observacoes = trim(coalesce(observacoes, '') || E'\nArquivado: ' || p_motivo)
   where id = p_documento;
  perform set_config('idealize.via_funcao', '', true);
end $$;

-- ---------------------------------------------------------------------
-- Autorização de download/visualização (a Edge Function gera a URL assinada)
-- Nenhuma linha retornada = acesso negado (tentativa fica auditada).
-- ---------------------------------------------------------------------
create or replace function public.documento_autorizar_acesso(p_documento uuid, p_versao int default null, p_acao text default 'visualizar')
returns table (storage_path text, nome_arquivo text, mime_type text)
language plpgsql security definer set search_path = '' as $$
declare v_doc public.documentos%rowtype; v_ver public.documento_versoes%rowtype;
begin
  if p_acao not in ('visualizar', 'download') then raise exception 'Ação inválida'; end if;
  select * into v_doc from public.documentos where id = p_documento;
  if v_doc.id is null then raise exception 'Documento não encontrado'; end if;
  if not privado.pode_documento('ler', v_doc.categoria_id, v_doc.loja_id) then
    -- sem erro para não desfazer o registro da tentativa; a Edge Function responde 403
    perform privado.registrar_evento('ACESSO_DOCUMENTO', 'documentos', p_documento::text, v_doc.loja_id,
      jsonb_build_object('acao', p_acao), 'negado');
    return;
  end if;
  select * into v_ver from public.documento_versoes dv
   where dv.documento_id = p_documento and dv.confirmado
     and dv.versao = coalesce(p_versao, v_doc.versao_atual);
  if v_ver.id is null then raise exception 'Versão não encontrada'; end if;

  insert into public.documento_acessos (documento_id, versao_id, acao) values (p_documento, v_ver.id, p_acao);
  return query select v_ver.storage_path, v_ver.nome_arquivo_original, v_ver.mime_type;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.documento_preparar_upload(uuid, jsonb, text, text, bigint, text, text)',
    'public.documento_confirmar_upload(uuid)',
    'public.documento_conferir(uuid, boolean, text)',
    'public.documento_arquivar(uuid, text)',
    'public.documento_autorizar_acesso(uuid, int, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
