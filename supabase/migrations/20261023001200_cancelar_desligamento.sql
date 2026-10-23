-- =====================================================================
-- Correção: cancelar um desligamento (Em desligamento → Ativo) agora
-- encerra o processo como 'cancelado', e um novo desligamento futuro
-- do mesmo vínculo passa a ser permitido. Histórico preservado.
-- =====================================================================

alter table public.desligamentos drop constraint if exists desligamentos_vinculo_id_key;
create unique index if not exists desligamentos_um_ativo_por_vinculo
  on public.desligamentos (vinculo_id) where status in ('em_andamento', 'concluido');

create or replace function public.alterar_status_vinculo(
  p_vinculo uuid, p_novo public.vinculo_status, p_motivo text, p_data_efeito date default current_date)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_loja uuid := privado.loja_do_vinculo(p_vinculo);
  v_atual public.vinculo_status; v_col uuid; v_req text; v_desl record;
begin
  if v_loja is null then raise exception 'Vínculo não encontrado'; end if;
  perform privado.exigir('vinculo.status.alterar', v_loja);
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da mudança de status'; end if;

  select status, colaborador_id into v_atual, v_col from public.vinculos where id = p_vinculo for update;
  select requisito into v_req from public.status_transicoes where de = v_atual and para = p_novo;
  if not found then
    raise exception 'Transição de status não permitida: % → %', v_atual, p_novo;
  end if;

  perform set_config('idealize.via_funcao', 'status', true);
  if v_req = 'desligamento_concluido' then
    select * into v_desl from public.desligamentos where vinculo_id = p_vinculo and status = 'concluido';
    if v_desl.id is null then
      raise exception 'Não é possível marcar como desligado sem processo de desligamento concluído';
    end if;
    update public.vinculos set status = p_novo, data_desligamento = v_desl.data_desligamento where id = p_vinculo;
    update public.lotacoes set fim = greatest(inicio, v_desl.data_desligamento) where vinculo_id = p_vinculo and fim is null;
    update public.historico_cargos set fim = greatest(inicio, v_desl.data_desligamento) where vinculo_id = p_vinculo and fim is null;
  else
    update public.vinculos set status = p_novo where id = p_vinculo;
  end if;
  perform set_config('idealize.via_funcao', '', true);

  -- saiu de "em desligamento" sem concluir: o processo é cancelado (não apagado)
  if v_atual = 'em_desligamento' and p_novo <> 'desligado' then
    update public.desligamentos
       set status = 'cancelado',
           observacoes = trim(coalesce(observacoes, '') || E'\nCancelado: ' || p_motivo)
     where vinculo_id = p_vinculo and status = 'em_andamento';
  end if;

  insert into public.vinculo_status_historico (vinculo_id, de, para, motivo, data_efeito)
  values (p_vinculo, v_atual, p_novo, p_motivo, p_data_efeito);
  perform privado.timeline(v_col, p_vinculo, 'status', p_data_efeito,
    'Status: ' || replace(v_atual::text, '_', ' ') || ' → ' || replace(p_novo::text, '_', ' '),
    null, 'contratual');
end $$;
