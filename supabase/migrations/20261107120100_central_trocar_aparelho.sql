-- quem perdeu ou trocou o celular: apaga o cadastro do autenticador; no próximo acesso lê um QR code novo
create or replace function public.central_trocar_aparelho(p_usuario uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if not privado.central_gestor() then raise exception 'Sem permissão para gerir acessos' using errcode = '42501'; end if;
  if p_usuario = auth.uid() then raise exception 'Para trocar o seu próprio aparelho, peça a outro gestor'; end if;
  if not exists (select 1 from public.usuarios u where u.id = p_usuario) then raise exception 'Usuário inexistente'; end if;
  with apagados as (delete from auth.mfa_factors f where f.user_id = p_usuario returning f.id)
  select count(*) into v_n from apagados;
  insert into public.audit_log (acao, tabela, registro_id, dados_antes, contexto)
  values ('DELETE', 'auth.mfa_factors', p_usuario::text, jsonb_build_object('fatores', v_n), jsonb_build_object('origem', 'central_trocar_aparelho'));
end $$;

revoke all on function public.central_trocar_aparelho(uuid) from public, anon;
grant execute on function public.central_trocar_aparelho(uuid) to authenticated;
