-- =====================================================================
-- IDEALIZE RH 360º — Convites pendentes (para "Reenviar convite")
-- Lista quem foi convidado e ainda não ativou a conta (nunca confirmou o
-- e-mail nem entrou). Só para quem gerencia acessos.
-- =====================================================================

create or replace function public.usuarios_convites_pendentes()
returns table (usuario_id uuid, convidado_em timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform privado.exigir('acesso.gerir', null);
  return query
    select a.id, coalesce(a.invited_at, a.created_at)
      from auth.users a
      join public.usuarios u on u.id = a.id
     where a.email_confirmed_at is null
       and a.last_sign_in_at is null
       and u.ativo;
end $$;
revoke all on function public.usuarios_convites_pendentes() from public, anon;
grant execute on function public.usuarios_convites_pendentes() to authenticated;
