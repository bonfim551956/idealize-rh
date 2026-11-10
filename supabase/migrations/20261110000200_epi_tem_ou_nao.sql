-- Equipamento/EPI na admissão: registrar se TEM ou NÃO TEM para entregar.
-- "Não tem" conclui o item (nem toda função usa EPI); "tem" continua pendente até lançar a entrega em Equipamentos.
alter table public.admissao_itens drop constraint admissao_itens_item_check;
alter table public.admissao_itens add constraint admissao_itens_item_check check (item in ('cartao_vr', 'cracha', 'epi_nao_tem'));

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
  sem_epi as (
    select a.id, a.data_entrega, u.nome, a.observacao from public.admissao_itens a left join public.usuarios u on u.id = a.registrado_por
     where a.colaborador_id = p_colaborador and a.item = 'epi_nao_tem' and not a.cancelado limit 1),
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
  select 'equipamento_epi', (select d from eq) is not null or exists (select 1 from sem_epi),
         coalesce((select d from eq), (select data_entrega from sem_epi)),
         coalesce((select nome from eq), (select nome from sem_epi)),
         case when (select d from eq) is not null then left((select itens from eq), 200)
              when exists (select 1 from sem_epi) then 'NÃO TEM EPI/EQUIPAMENTO PARA ENTREGAR' || coalesce(' · ' || (select observacao from sem_epi), '') end,
         case when (select d from eq) is not null then 'equipamentos' when exists (select 1 from sem_epi) then 'manual' end,
         case when (select d from eq) is null then (select id from sem_epi) end;
$$;
revoke all on function privado.admissao_itens_situacao(uuid) from public, anon, authenticated;

create or replace function public.admissao_registrar_item(p_colaborador uuid, p_item text, p_data date, p_observacao text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_loja uuid := privado.loja_do_colaborador(p_colaborador); v_id uuid;
begin
  if v_loja is null then raise exception 'Colaborador não encontrado'; end if;
  perform privado.exigir('equipamento.gerir', v_loja);
  if p_item not in ('cartao_vr', 'cracha', 'epi_nao_tem') then raise exception 'Item inválido'; end if;
  if p_data is null or p_data > current_date + 30 then raise exception 'Informe a data da entrega'; end if;
  if exists (select 1 from public.admissao_itens a where a.colaborador_id = p_colaborador and a.item = p_item and not a.cancelado) then
    raise exception 'Entrega já registrada; desfaça o registro anterior para corrigir';
  end if;
  insert into public.admissao_itens (colaborador_id, item, data_entrega, observacao)
  values (p_colaborador, p_item, p_data, nullif(trim(p_observacao), '')) returning id into v_id;
  perform privado.timeline(p_colaborador, null, 'admissao', p_data,
    case p_item when 'cartao_vr' then 'ENTREGA DO CARTÃO VR' when 'cracha' then 'ENTREGA DE CRACHÁ' else 'SEM EPI/EQUIPAMENTO PARA ENTREGAR' end,
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
    'REGISTRO DESFEITO: ' || case v.item when 'cartao_vr' then 'CARTÃO VR' when 'cracha' then 'CRACHÁ' else 'SEM EPI/EQUIPAMENTO' end, upper(trim(p_motivo)), 'geral');
end $$;
revoke all on function public.admissao_cancelar_item(uuid, text) from public, anon;
grant execute on function public.admissao_cancelar_item(uuid, text) to authenticated;
