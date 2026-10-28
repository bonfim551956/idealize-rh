-- =====================================================================
-- IDEALIZE RH 360º — Efetivar contrato de experiência
-- Passa o vínculo de "CLT - experiência" para "CLT - prazo indeterminado"
-- na data informada; fica na linha do tempo e na auditoria.
-- =====================================================================
create or replace function public.efetivar_contrato(p_vinculo uuid, p_data date, p_observacao text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  select vi.*, privado.loja_do_vinculo(vi.id) as loja into r from public.vinculos vi where vi.id = p_vinculo for update;
  if r.id is null then raise exception 'Vínculo não encontrado'; end if;
  perform privado.exigir('colaborador.editar', r.loja);
  if r.tipo <> 'clt_experiencia' then raise exception 'Este contrato não está em experiência'; end if;
  if r.status in ('desligado', 'arquivado', 'em_desligamento') then raise exception 'Vínculo encerrado ou em desligamento'; end if;
  if p_data is null or p_data <= r.data_admissao or p_data > current_date + 30 then
    raise exception 'Data de efetivação inválida (precisa ser depois da admissão)';
  end if;
  update public.vinculos set tipo = 'clt_prazo_indeterminado' where id = p_vinculo;
  perform privado.timeline(r.colaborador_id, r.id, 'contrato', p_data,
    'CONTRATO EFETIVADO: PRAZO INDETERMINADO A PARTIR DE ' || to_char(p_data, 'DD/MM/YYYY'),
    upper(nullif(trim(p_observacao), '')), 'contratual');
end $$;
revoke all on function public.efetivar_contrato(uuid, date, text) from public, anon;
grant execute on function public.efetivar_contrato(uuid, date, text) to authenticated;
