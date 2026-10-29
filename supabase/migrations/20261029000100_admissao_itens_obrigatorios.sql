-- =====================================================================
-- IDEALIZE RH 360º — Itens obrigatórios da admissão
-- Para todo colaborador (pré-admissão, em admissão e ativos):
--   cartão VR · uniforme · crachá · termo de uso de imagem · equipamento/EPI
-- Uniforme e equipamento/EPI concluem sozinhos pelas abas próprias;
-- crachá conclui por registro manual ou por equipamento "CRACHÁ";
-- cartão VR por registro manual; termo de imagem pelo documento anexado.
-- Pendências do Painel alertam quem ainda tem item pendente.
-- =====================================================================

insert into public.doc_categorias (codigo, nome, nivel_sigilo, exige_vencimento, exige_competencia, retencao_observacao, dica_ia)
values ('termo_uso_imagem', 'Termos de autorização de uso de imagem', 'geral', false, false,
        'Guardar enquanto a imagem puder ser usada e após o desligamento, conforme orientação jurídica',
        'Termo ou autorização de uso de imagem, voz e nome do colaborador em fotos, vídeos e redes sociais')
on conflict (codigo) do nothing;

create table public.admissao_itens (
  id               uuid primary key default gen_random_uuid(),
  colaborador_id   uuid not null references public.colaboradores(id) on delete restrict,
  item             text not null check (item in ('cartao_vr', 'cracha')),
  data_entrega     date not null,
  observacao       text check (observacao is null or length(observacao) <= 300),
  cancelado        boolean not null default false,
  cancelado_motivo text,
  registrado_por   uuid references public.usuarios(id) default auth.uid(),
  registrado_em    timestamptz not null default now()
);
create unique index admissao_itens_unico on public.admissao_itens (colaborador_id, item) where not cancelado;
create trigger a_maiusculas before insert or update on public.admissao_itens
  for each row execute function privado.maiusculas('observacao', 'cancelado_motivo');
create trigger auditar after insert or update or delete on public.admissao_itens
  for each row execute function privado.auditar();
create or replace function privado.travar_admissao_item()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Registros da admissão não são apagados; cancele com motivo'; end if;
  if coalesce(current_setting('idealize.via_funcao', true), '') <> 'admissao' then
    raise exception 'Registros da admissão só mudam pelas funções próprias' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger travar before update or delete on public.admissao_itens
  for each row execute function privado.travar_admissao_item();
alter table public.admissao_itens enable row level security;
create policy admissao_itens_ler on public.admissao_itens for select to authenticated
  using (privado.pode('colaborador.ler', privado.loja_do_colaborador(colaborador_id)));
revoke insert, update, delete, truncate on public.admissao_itens from anon, authenticated;
revoke all on public.admissao_itens from anon;

-- ---------------------------------------------------------------------
-- Situação dos 5 itens (sem checagem de permissão; quem chama filtra)
-- ---------------------------------------------------------------------
create or replace function privado.admissao_itens_situacao(p_colaborador uuid)
returns table (item text, concluido boolean, data date, por text, detalhe text, origem text, registro_id uuid)
language sql stable security definer set search_path = '' as $$
  with
  vr as (
    select a.id, a.data_entrega, u.nome, a.observacao from public.admissao_itens a left join public.usuarios u on u.id = a.registrado_por
     where a.colaborador_id = p_colaborador and a.item = 'cartao_vr' and not a.cancelado limit 1),
  cr_manual as (
    select a.id, a.data_entrega, u.nome, a.observacao from public.admissao_itens a left join public.usuarios u on u.id = a.registrado_por
     where a.colaborador_id = p_colaborador and a.item = 'cracha' and not a.cancelado limit 1),
  cr_eq as (
    select e.data_entrega, u.nome from public.equipamentos e left join public.usuarios u on u.id = e.registrado_por
     where e.colaborador_id = p_colaborador and not e.cancelado and e.tipo ilike 'CRACH%' order by e.data_entrega limit 1),
  uni as (
    select min(m.data_movimento) as d,
           string_agg(m.quantidade || ' ' || i.peca || ' ' || i.tamanho, ', ' order by i.peca) as itens,
           (array_agg(coalesce(m.registrado_por_nome, u.nome) order by m.data_movimento))[1] as nome
      from public.uniforme_movimentos m join public.uniforme_itens i on i.id = m.item_id
      left join public.usuarios u on u.id = m.registrado_por
     where m.colaborador_id = p_colaborador and m.tipo = 'saida'
       and not exists (select 1 from public.uniforme_movimentos x where x.estorno_de = m.id)),
  eq as (
    select min(e.data_entrega) as d,
           string_agg(e.tipo || coalesce(' ' || e.descricao, ''), ', ' order by e.data_entrega) as itens,
           (array_agg(u.nome order by e.data_entrega))[1] as nome
      from public.equipamentos e left join public.usuarios u on u.id = e.registrado_por
     where e.colaborador_id = p_colaborador and not e.cancelado and e.tipo not ilike 'CRACH%'),
  termo as (
    select coalesce(d.data_emissao, d.criado_em::date) as d, u.nome, d.nome as doc
      from public.documentos d join public.doc_categorias k on k.id = d.categoria_id
      left join public.usuarios u on u.id = d.criado_por
     where d.colaborador_id = p_colaborador and k.codigo = 'termo_uso_imagem'
       and d.status not in ('reprovado', 'arquivado', 'nao_solicitado', 'pendente')
     order by d.criado_em limit 1)
  select 'cartao_vr', exists (select 1 from vr), (select data_entrega from vr), (select nome from vr), (select observacao from vr),
         case when exists (select 1 from vr) then 'manual' end, (select id from vr)
  union all
  select 'uniforme', (select d from uni) is not null, (select d from uni), (select nome from uni), left((select itens from uni), 200),
         case when (select d from uni) is not null then 'uniformes' end, null
  union all
  select 'cracha', exists (select 1 from cr_manual) or exists (select 1 from cr_eq),
         coalesce((select data_entrega from cr_manual), (select data_entrega from cr_eq)),
         coalesce((select nome from cr_manual), (select nome from cr_eq)),
         case when exists (select 1 from cr_manual) then (select observacao from cr_manual) when exists (select 1 from cr_eq) then 'LANÇADO EM EQUIPAMENTOS' end,
         case when exists (select 1 from cr_manual) then 'manual' when exists (select 1 from cr_eq) then 'equipamentos' end,
         (select id from cr_manual)
  union all
  select 'termo_imagem', exists (select 1 from termo), (select d from termo), (select nome from termo), (select doc from termo),
         case when exists (select 1 from termo) then 'documento' end, null
  union all
  select 'equipamento_epi', (select d from eq) is not null, (select d from eq), (select nome from eq), left((select itens from eq), 200),
         case when (select d from eq) is not null then 'equipamentos' end, null;
$$;
revoke all on function privado.admissao_itens_situacao(uuid) from public, anon, authenticated;

create or replace function public.admissao_checklist(p_colaborador uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not privado.pode('colaborador.ler', privado.loja_do_colaborador(p_colaborador)) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from privado.admissao_itens_situacao(p_colaborador) s);
end $$;
revoke all on function public.admissao_checklist(uuid) from public, anon;
grant execute on function public.admissao_checklist(uuid) to authenticated;

-- registrar entrega de cartão VR ou crachá (quem entrega equipamentos na loja também registra)
create or replace function public.admissao_registrar_item(p_colaborador uuid, p_item text, p_data date, p_observacao text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_loja uuid := privado.loja_do_colaborador(p_colaborador); v_id uuid;
begin
  if v_loja is null then raise exception 'Colaborador não encontrado'; end if;
  perform privado.exigir('equipamento.gerir', v_loja);
  if p_item not in ('cartao_vr', 'cracha') then raise exception 'Item inválido'; end if;
  if p_data is null or p_data > current_date + 30 then raise exception 'Informe a data da entrega'; end if;
  if exists (select 1 from public.admissao_itens a where a.colaborador_id = p_colaborador and a.item = p_item and not a.cancelado) then
    raise exception 'Entrega já registrada; desfaça o registro anterior para corrigir';
  end if;
  insert into public.admissao_itens (colaborador_id, item, data_entrega, observacao)
  values (p_colaborador, p_item, p_data, nullif(trim(p_observacao), '')) returning id into v_id;
  perform privado.timeline(p_colaborador, null, 'admissao', p_data,
    case p_item when 'cartao_vr' then 'ENTREGA DO CARTÃO VR' else 'ENTREGA DE CRACHÁ' end,
    upper(nullif(trim(p_observacao), '')), 'geral');
  return v_id;
end $$;
revoke all on function public.admissao_registrar_item(uuid, text, date, text) from public, anon;
grant execute on function public.admissao_registrar_item(uuid, text, date, text) to authenticated;

create or replace function public.admissao_cancelar_item(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  select a.*, privado.loja_do_colaborador(a.colaborador_id) as loja into v from public.admissao_itens a where a.id = p_id for update;
  if v.id is null then raise exception 'Registro não encontrado'; end if;
  perform privado.exigir('equipamento.gerir', v.loja);
  if v.cancelado then raise exception 'Registro já desfeito'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo'; end if;
  perform set_config('idealize.via_funcao', 'admissao', true);
  update public.admissao_itens set cancelado = true, cancelado_motivo = trim(p_motivo) where id = p_id;
  perform set_config('idealize.via_funcao', '', true);
  perform privado.timeline(v.colaborador_id, null, 'admissao', current_date,
    'REGISTRO DESFEITO: ' || case v.item when 'cartao_vr' then 'CARTÃO VR' else 'CRACHÁ' end, upper(trim(p_motivo)), 'geral');
end $$;
revoke all on function public.admissao_cancelar_item(uuid, text) from public, anon;
grant execute on function public.admissao_cancelar_item(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Pendência no Painel
-- ---------------------------------------------------------------------
do $do$ declare d text; bloco text; ancora text; begin
  d := pg_get_functiondef('public.painel_pendencias(uuid)'::regprocedure);
  bloco := $b$

  -- 0) Itens obrigatórios da admissão
  select count(*), coalesce(jsonb_agg(x) filter (where rn <= 6), '[]') into n, itens from (
    select jsonb_build_object('nome', q.nome_completo,
             'detalhe', case when q.status in ('pre_admissao', 'em_admissao') then 'admissão prevista ' else 'admitido(a) em ' end
               || coalesce(to_char(q.data_admissao, 'DD/MM/YYYY'), 'sem data') || ' · falta: ' || q.faltam,
             'link', '/colaboradores/' || q.id || '?aba=admissao') x,
           row_number() over (order by q.data_admissao desc nulls first, q.nome_completo) rn
      from (select c.id, c.nome_completo, v.status, v.data_admissao,
                   (select string_agg(case s.item when 'cartao_vr' then 'cartão VR' when 'uniforme' then 'uniforme' when 'cracha' then 'crachá'
                                                  when 'termo_imagem' then 'termo de uso de imagem' else 'equipamento/EPI' end, ', ')
                      from privado.admissao_itens_situacao(c.id) s where not s.concluido) as faltam
              from public.colaboradores c
              join lateral (select v.status, v.data_admissao from public.vinculos v where v.colaborador_id = c.id
                              and v.status in ('pre_admissao', 'em_admissao', 'ativo', 'em_ferias', 'afastado', 'em_licenca')
                            order by v.data_admissao desc nulls first limit 1) v on true
             where (p_loja is null or c.loja_atual_id = p_loja) and privado.pode('colaborador.ler', c.loja_atual_id)) q
     where q.faltam is not null) s;
  if n > 0 then r := r || jsonb_build_object('chave', 'admissao_itens', 'titulo', 'Admissões com itens obrigatórios pendentes', 'gravidade', 'alta',
    'quantidade', n, 'link', '/colaboradores', 'acao', 'Ver colaboradores', 'itens', itens); end if;
$b$;
  ancora := 'begin';
  if position('admissao_itens' in d) > 0 then raise exception 'já aplicado'; end if;
  -- insere logo após o primeiro "begin" do corpo
  d := regexp_replace(d, '\nbegin\n', E'\nbegin\n' || replace(bloco, '\', '\\') || E'\n');
  if position('admissao_itens' in d) = 0 then raise exception 'ponto de inserção não encontrado'; end if;
  execute d;
end $do$;
