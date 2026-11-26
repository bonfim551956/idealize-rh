-- Gerar o termo de uso de imagem conta como atividade feita:
-- conclui o item "Termo de uso de imagem" da admissão e registra na linha do tempo.
-- O termo assinado continua podendo ser anexado depois (fica guardado em Documentos).

alter table public.admissao_itens drop constraint admissao_itens_item_check;
alter table public.admissao_itens add constraint admissao_itens_item_check check (item in ('cartao_vr', 'cracha', 'epi_nao_tem', 'termo_imagem'));

create or replace function public.admissao_termo_imagem_gerado(p_colaborador uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_loja uuid := privado.loja_do_colaborador(p_colaborador); v_novo boolean;
begin
  if v_loja is null then raise exception 'Colaborador não encontrado'; end if;
  perform privado.exigir('colaborador.ler', v_loja);
  v_novo := not exists (select 1 from public.admissao_itens a where a.colaborador_id = p_colaborador and a.item = 'termo_imagem' and not a.cancelado);
  if v_novo then
    insert into public.admissao_itens (colaborador_id, item, data_entrega, observacao)
    values (p_colaborador, 'termo_imagem', current_date, 'TERMO GERADO PELO SISTEMA');
  end if;
  perform privado.timeline(p_colaborador, null, 'admissao', current_date,
    case when v_novo then 'TERMO DE USO DE IMAGEM GERADO' else 'TERMO DE USO DE IMAGEM IMPRESSO NOVAMENTE' end, null, 'geral');
end $$;
revoke all on function public.admissao_termo_imagem_gerado(uuid) from public, anon;
grant execute on function public.admissao_termo_imagem_gerado(uuid) to authenticated;

do $$
declare d text := pg_get_functiondef('privado.admissao_itens_situacao(uuid)'::regprocedure); n int;
  t text[] := array[
    E'  termo as (\n',
    E'  ti_manual as (\n    select a.id, a.data_entrega, u.nome, a.observacao from public.admissao_itens a left join public.usuarios u on u.id = a.registrado_por\n     where a.colaborador_id = p_colaborador and a.item = ''termo_imagem'' and not a.cancelado limit 1),\n  termo as (\n',
    E'  select ''termo_imagem'', exists (select 1 from termo), (select d from termo), (select nome from termo), (select doc from termo),\n         case when exists (select 1 from termo) then ''documento'' end, null',
    E'  select ''termo_imagem'', exists (select 1 from termo) or exists (select 1 from ti_manual),\n         coalesce((select d from termo), (select data_entrega from ti_manual)), coalesce((select nome from termo), (select nome from ti_manual)),\n         coalesce((select doc from termo), (select observacao from ti_manual) || '' · FALTA ANEXAR O ASSINADO''),\n         case when exists (select 1 from termo) then ''documento'' when exists (select 1 from ti_manual) then ''manual'' end,\n         case when not exists (select 1 from termo) then (select id from ti_manual) end'];
begin
  for i in 1..array_length(t, 1) by 2 loop
    n := (length(d) - length(replace(d, t[i], ''))) / length(t[i]);
    if n <> 1 then raise exception 'admissao_itens_situacao mudou: trecho não encontrado: %', left(t[i], 60); end if;
    d := replace(d, t[i], t[i+1]);
  end loop;
  execute d;
end $$;
