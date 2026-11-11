-- IDEALIZE RH 360º — Advertências (verbal, escrita, suspensão) com motivo, data e termo assinado
-- Sigilo disciplinar: lê quem tem documento.disciplinar.ler; registra quem tem documento.disciplinar.enviar.

create table public.advertencia_motivos (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null unique check (length(trim(nome)) between 3 and 80),
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);
create trigger a_maiusculas before insert or update on public.advertencia_motivos
  for each row execute function privado.maiusculas('nome');
insert into public.advertencia_motivos (nome) values
  ('ATRASO'), ('FALTA INJUSTIFICADA'), ('SAÍDA ANTECIPADA SEM AUTORIZAÇÃO'), ('USO INDEVIDO DE CELULAR'),
  ('DESCUMPRIMENTO DE PROCEDIMENTO'), ('UNIFORME / APRESENTAÇÃO'), ('RECUSA DE USO DE EPI'),
  ('CONDUTA INADEQUADA COM CLIENTE'), ('CONDUTA INADEQUADA COM COLEGA'), ('INSUBORDINAÇÃO'), ('DIFERENÇA DE CAIXA');
alter table public.advertencia_motivos enable row level security;
create policy advertencia_motivos_ler on public.advertencia_motivos for select to authenticated
  using (privado.pode_em_alguma('documento.disciplinar.ler'));
revoke insert, update, delete, truncate on public.advertencia_motivos from anon, authenticated;
revoke all on public.advertencia_motivos from anon;

create table public.advertencias (
  id               uuid primary key default gen_random_uuid(),
  colaborador_id   uuid not null references public.colaboradores(id) on delete restrict,
  tipo             text not null check (tipo in ('verbal', 'escrita', 'suspensao')),
  dias_suspensao   int check (dias_suspensao between 1 and 30),
  data_ocorrencia  date not null,
  data_aplicacao   date not null,
  motivo_id        uuid references public.advertencia_motivos(id),
  motivo           text not null check (length(trim(motivo)) between 3 and 120),
  descricao        text not null check (length(trim(descricao)) between 10 and 4000),
  testemunhas      text check (testemunhas is null or length(testemunhas) <= 300),
  situacao         text not null default 'aguardando' check (situacao in ('aguardando', 'assinada', 'recusou')),
  documento_id     uuid references public.documentos(id),
  cancelada        boolean not null default false,
  cancelada_motivo text,
  cancelada_por    uuid references public.usuarios(id),
  cancelada_em     timestamptz,
  registrado_por   uuid references public.usuarios(id) default auth.uid(),
  registrado_em    timestamptz not null default now(),
  check ((tipo = 'suspensao') = (dias_suspensao is not null)),
  check (data_aplicacao >= data_ocorrencia),
  check (not cancelada or (cancelada_motivo is not null and cancelada_em is not null))
);
create index on public.advertencias (colaborador_id, data_ocorrencia desc);
create trigger a_maiusculas before insert or update on public.advertencias
  for each row execute function privado.maiusculas('motivo', 'descricao', 'testemunhas', 'cancelada_motivo');
create trigger auditar after insert or update or delete on public.advertencias
  for each row execute function privado.auditar();
alter table public.advertencias enable row level security;
revoke all on public.advertencias from anon, authenticated;

-- lista (página e ficha)
create or replace function public.advertencias_listar(p_loja uuid default null, p_colaborador uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not privado.pode_em_alguma('documento.disciplinar.ler') then raise exception 'Acesso negado' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'colaborador_id', a.colaborador_id, 'colaborador_nome', c.nome_completo, 'loja_id', c.loja_atual_id,
      'loja_nome', l.nome, 'cargo_nome', vc.cargo_nome,
      'cpf', case when privado.pode('colaborador.dados_pessoais.ler', c.loja_atual_id) then c.cpf end,
      'tipo', a.tipo, 'dias_suspensao', a.dias_suspensao, 'data_ocorrencia', a.data_ocorrencia, 'data_aplicacao', a.data_aplicacao,
      'motivo', a.motivo, 'descricao', a.descricao, 'testemunhas', a.testemunhas, 'situacao', a.situacao,
      'documento_id', a.documento_id, 'registrado_por_nome', u.nome,
      'anteriores_90d', (select count(*) from public.advertencias x where x.colaborador_id = a.colaborador_id and not x.cancelada and x.id <> a.id
                           and x.data_ocorrencia between a.data_ocorrencia - 90 and a.data_ocorrencia))
      order by a.data_ocorrencia desc, a.registrado_em desc), '[]')
    from public.advertencias a
    join public.colaboradores c on c.id = a.colaborador_id
    left join public.lojas l on l.id = c.loja_atual_id
    left join lateral (select v.cargo_nome from public.v_colaboradores v where v.id = c.id limit 1) vc on true
    left join public.usuarios u on u.id = a.registrado_por
   where not a.cancelada
     and (p_colaborador is null or a.colaborador_id = p_colaborador)
     and (p_loja is null or c.loja_atual_id = p_loja)
     and privado.pode('documento.disciplinar.ler', c.loja_atual_id));
end $$;
revoke all on function public.advertencias_listar(uuid, uuid) from public, anon;
grant execute on function public.advertencias_listar(uuid, uuid) to authenticated;

create or replace function public.advertencia_registrar(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_colab uuid := (privado.texto(p, 'colaborador_id'))::uuid;
  v_loja  uuid := privado.loja_do_colaborador(v_colab);
  v_tipo  text := privado.texto(p, 'tipo');
  v_dias  int  := nullif(privado.texto(p, 'dias_suspensao'), '')::int;
  v_oc    date := (privado.texto(p, 'data_ocorrencia'))::date;
  v_ap    date := coalesce((privado.texto(p, 'data_aplicacao'))::date, current_date);
  v_mid   uuid := nullif(privado.texto(p, 'motivo_id'), '')::uuid;
  v_mot   text := coalesce((select m.nome from public.advertencia_motivos m where m.id = v_mid), privado.texto(p, 'motivo_texto'));
  v_id    uuid;
begin
  if v_loja is null then raise exception 'Colaborador não encontrado'; end if;
  perform privado.exigir('documento.disciplinar.enviar', v_loja);
  if v_tipo not in ('verbal', 'escrita', 'suspensao') then raise exception 'Tipo inválido'; end if;
  if v_tipo <> 'suspensao' then v_dias := null; end if;
  if v_tipo = 'suspensao' and (v_dias is null or v_dias not between 1 and 30) then raise exception 'Suspensão de 1 a 30 dias'; end if;
  if v_oc is null or v_oc > current_date then raise exception 'Informe a data da ocorrência'; end if;
  if v_ap < v_oc then raise exception 'A aplicação não pode ser antes da ocorrência'; end if;
  if coalesce(trim(v_mot), '') = '' then raise exception 'Informe o motivo'; end if;
  insert into public.advertencias (colaborador_id, tipo, dias_suspensao, data_ocorrencia, data_aplicacao, motivo_id, motivo, descricao, testemunhas)
  values (v_colab, v_tipo, v_dias, v_oc, v_ap, v_mid, trim(v_mot), trim(privado.texto(p, 'descricao')), nullif(trim(privado.texto(p, 'testemunhas')), ''))
  returning id into v_id;
  perform privado.timeline(v_colab, null, 'advertencia', v_oc,
    case v_tipo when 'suspensao' then 'SUSPENSÃO DE ' || v_dias || ' DIA(S)' when 'verbal' then 'ADVERTÊNCIA VERBAL' else 'ADVERTÊNCIA ESCRITA' end,
    upper(trim(v_mot)), 'disciplinar');
  return v_id;
end $$;
revoke all on function public.advertencia_registrar(jsonb) from public, anon;
grant execute on function public.advertencia_registrar(jsonb) to authenticated;

create or replace function public.advertencia_anexar(p_id uuid, p_documento uuid, p_recusou boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  select a.*, privado.loja_do_colaborador(a.colaborador_id) as loja into v from public.advertencias a where a.id = p_id for update;
  if v.id is null or v.cancelada then raise exception 'Advertência não encontrada'; end if;
  perform privado.exigir('documento.disciplinar.enviar', v.loja);
  if not exists (select 1 from public.documentos d where d.id = p_documento and d.colaborador_id = v.colaborador_id) then
    raise exception 'Documento não pertence a este colaborador';
  end if;
  update public.advertencias set documento_id = p_documento, situacao = case when p_recusou then 'recusou' else 'assinada' end where id = p_id;
end $$;
revoke all on function public.advertencia_anexar(uuid, uuid, boolean) from public, anon;
grant execute on function public.advertencia_anexar(uuid, uuid, boolean) to authenticated;

create or replace function public.advertencia_cancelar(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  select a.*, privado.loja_do_colaborador(a.colaborador_id) as loja into v from public.advertencias a where a.id = p_id for update;
  if v.id is null then raise exception 'Advertência não encontrada'; end if;
  perform privado.exigir('documento.disciplinar.enviar', v.loja);
  if v.cancelada then raise exception 'Já cancelada'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo do cancelamento'; end if;
  update public.advertencias set cancelada = true, cancelada_motivo = trim(p_motivo), cancelada_por = auth.uid(), cancelada_em = now() where id = p_id;
  perform privado.timeline(v.colaborador_id, null, 'advertencia', current_date, 'ADVERTÊNCIA CANCELADA', upper(trim(p_motivo)), 'disciplinar');
end $$;
revoke all on function public.advertencia_cancelar(uuid, text) from public, anon;
grant execute on function public.advertencia_cancelar(uuid, text) to authenticated;

create or replace function public.advertencia_motivo_salvar(p_id uuid, p_nome text, p_ativo boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not privado.pode_em_alguma('config.estrutura.gerir') then raise exception 'Acesso negado' using errcode = '42501'; end if;
  if length(trim(coalesce(p_nome, ''))) < 3 then raise exception 'Informe o motivo'; end if;
  if p_id is null then
    insert into public.advertencia_motivos (nome, ativo) values (trim(p_nome), coalesce(p_ativo, true))
    on conflict (nome) do update set ativo = true returning id into v_id;
  else
    update public.advertencia_motivos set nome = trim(p_nome), ativo = coalesce(p_ativo, true) where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.advertencia_motivo_salvar(uuid, text, boolean) from public, anon;
grant execute on function public.advertencia_motivo_salvar(uuid, text, boolean) to authenticated;

-- Pendência no Painel: termo de advertência sem assinatura anexada há mais de 3 dias
do $do$ declare d text; bloco text; begin
  d := pg_get_functiondef('public.painel_pendencias(uuid)'::regprocedure);
  if position('advertencias_assinatura' in d) > 0 then raise exception 'já aplicado'; end if;
  bloco := $b$

  -- Advertências aguardando o termo assinado
  select count(*), coalesce(jsonb_agg(x) filter (where rn <= 6), '[]') into n, itens from (
    select jsonb_build_object('nome', c.nome_completo,
             'detalhe', case a.tipo when 'suspensao' then 'suspensão' when 'verbal' then 'advertência verbal' else 'advertência escrita' end
               || ' de ' || to_char(a.data_aplicacao, 'DD/MM') || ' · ' || lower(a.motivo),
             'link', '/colaboradores/' || c.id || '?aba=advertencias') x,
           row_number() over (order by a.data_aplicacao) rn
      from public.advertencias a join public.colaboradores c on c.id = a.colaborador_id
     where not a.cancelada and a.situacao = 'aguardando' and a.data_aplicacao < current_date - 3
       and (p_loja is null or c.loja_atual_id = p_loja) and privado.pode('documento.disciplinar.ler', c.loja_atual_id)) s;
  if n > 0 then r := r || jsonb_build_object('chave', 'advertencias_assinatura', 'titulo', 'Advertências sem termo assinado', 'gravidade', 'media',
    'quantidade', n, 'link', '/advertencias', 'acao', 'Ver advertências', 'itens', itens); end if;
$b$;
  d := regexp_replace(d, '\nbegin\n', E'\nbegin\n' || replace(bloco, '\', '\\') || E'\n');
  if position('advertencias_assinatura' in d) = 0 then raise exception 'ponto de inserção não encontrado'; end if;
  execute d;
end $do$;
