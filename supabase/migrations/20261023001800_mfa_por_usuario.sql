-- =====================================================================
-- IDEALIZE RH 360º — Migração 018: verificação em duas etapas por usuário
-- Decisão do proprietário (23/10/2026): na implantação, só a conta dele
-- exige o autenticador. Para os demais, as permissões marcadas com
-- exige_mfa valem com login e senha. Quem gere acessos liga/desliga a
-- exigência por usuário (nunca para si mesmo) e tudo fica auditado.
-- =====================================================================

alter table public.usuarios add column if not exists mfa_obrigatorio boolean not null default false;
comment on column public.usuarios.mfa_obrigatorio is
  'true = permissões sensíveis só liberam após a verificação em duas etapas (AAL2)';

update public.usuarios set mfa_obrigatorio = true where email = 'diegobonfim.idealize@gmail.com';

-- "Sessão liberada para dados sensíveis": MFA concluído, ou usuário sem exigência de MFA
create or replace function privado.sessao_aal2()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
      or not coalesce((select u.mfa_obrigatorio from public.usuarios u where u.id = auth.uid()), true);
$$;

create or replace function public.definir_mfa_obrigatorio(p_usuario uuid, p_obrigatorio boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not privado.pode('acesso.gerir') then
    raise exception 'Sem permissão para alterar a verificação em duas etapas' using errcode = '42501';
  end if;
  if p_usuario = auth.uid() then
    raise exception 'Não é permitido alterar a própria exigência de verificação' using errcode = '42501';
  end if;
  update public.usuarios set mfa_obrigatorio = coalesce(p_obrigatorio, true) where id = p_usuario;
  if not found then raise exception 'Usuário não encontrado'; end if;
end $$;
revoke all on function public.definir_mfa_obrigatorio(uuid, boolean) from public, anon;
grant execute on function public.definir_mfa_obrigatorio(uuid, boolean) to authenticated;
