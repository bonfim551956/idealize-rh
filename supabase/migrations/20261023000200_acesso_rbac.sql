-- =====================================================================
-- IDEALIZE RH 360º — Migração 002: usuários, perfis, permissões (RBAC + escopo por loja)
-- =====================================================================
-- Modelo:
--   usuário --(atribuição: perfil + loja opcional)--> perfil --> permissões
--   loja_id NULL na atribuição = vale para todas as lojas.
--   Permissões marcadas com exige_mfa só valem em sessão AAL2 (MFA concluído).
-- Toda checagem de acesso passa por privado.pode(permissao, loja_id),
-- usada pelas políticas RLS. A interface nunca é a barreira de segurança.
-- =====================================================================

create table public.usuarios (
  id              uuid primary key references auth.users(id) on delete restrict,
  nome            text not null check (length(trim(nome)) > 1),
  email           text not null unique,
  ativo           boolean not null default true,
  colaborador_id  uuid,              -- vínculo opcional com o cadastro de colaborador (FK na migração 003)
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  desativado_em   timestamptz,
  desativado_por  uuid references public.usuarios(id)
);

create table public.perfis (
  id          uuid primary key default gen_random_uuid(),
  codigo      text not null unique check (codigo ~ '^[a-z_]{3,40}$'),
  nome        text not null,
  descricao   text,
  de_sistema  boolean not null default false,  -- perfis iniciais não podem ser apagados
  criado_em   timestamptz not null default now()
);

create table public.permissoes (
  codigo      text primary key check (codigo ~ '^[a-z_]+(\.[a-z_]+)+$'),
  modulo      text not null,
  descricao   text not null,
  exige_mfa   boolean not null default false,
  sensivel    boolean not null default false
);

create table public.perfil_permissoes (
  perfil_id   uuid not null references public.perfis(id) on delete cascade,
  permissao   text not null references public.permissoes(codigo) on delete cascade,
  primary key (perfil_id, permissao)
);

create table public.usuario_atribuicoes (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null references public.usuarios(id) on delete restrict,
  perfil_id     uuid not null references public.perfis(id) on delete restrict,
  loja_id       uuid references public.lojas(id) on delete restrict,  -- NULL = todas as lojas
  ativo         boolean not null default true,
  valido_ate    timestamptz,
  concedido_por uuid references public.usuarios(id),
  concedido_em  timestamptz not null default now(),
  revogado_por  uuid references public.usuarios(id),
  revogado_em   timestamptz,
  motivo        text
);
create unique index usuario_atribuicoes_unica_ativa
  on public.usuario_atribuicoes (usuario_id, perfil_id, coalesce(loja_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where ativo;
create index on public.usuario_atribuicoes (usuario_id) where ativo;

create trigger usuarios_atualizado before update on public.usuarios
  for each row execute function privado.tocar_atualizado_em();

-- ---------------------------------------------------------------------
-- Funções de autorização
-- ---------------------------------------------------------------------
create or replace function privado.sessao_aal2()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

create or replace function privado.pode(p_permissao text, p_loja uuid default null)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.usuario_atribuicoes ua
      join public.usuarios u          on u.id = ua.usuario_id
      join public.perfil_permissoes pp on pp.perfil_id = ua.perfil_id
      join public.permissoes p         on p.codigo = pp.permissao
     where ua.usuario_id = auth.uid()
       and u.ativo
       and ua.ativo
       and (ua.valido_ate is null or ua.valido_ate > now())
       and pp.permissao = p_permissao
       and (ua.loja_id is null or ua.loja_id = p_loja)
       and (not p.exige_mfa or privado.sessao_aal2())
  );
$$;
comment on function privado.pode is
  'true se o usuário logado tem a permissão para a loja informada. loja NULL = recurso global: só atribuições globais valem.';

-- Tem a permissão em pelo menos uma loja (para menus e listas filtradas)
create or replace function privado.pode_em_alguma(p_permissao text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.usuario_atribuicoes ua
      join public.usuarios u          on u.id = ua.usuario_id
      join public.perfil_permissoes pp on pp.perfil_id = ua.perfil_id
      join public.permissoes p         on p.codigo = pp.permissao
     where ua.usuario_id = auth.uid()
       and u.ativo and ua.ativo
       and (ua.valido_ate is null or ua.valido_ate > now())
       and pp.permissao = p_permissao
       and (not p.exige_mfa or privado.sessao_aal2())
  );
$$;

revoke all on function privado.pode(text, uuid) from public, anon;
revoke all on function privado.pode_em_alguma(text) from public, anon;
grant execute on function privado.pode(text, uuid) to authenticated;
grant execute on function privado.pode_em_alguma(text) to authenticated;
grant execute on function privado.sessao_aal2() to authenticated;

-- Para a interface montar menus: permissões efetivas do usuário logado
create or replace function public.minhas_permissoes()
returns table (permissao text, loja_id uuid, exige_mfa boolean, liberada_na_sessao boolean)
language sql stable security definer set search_path = '' as $$
  select distinct pp.permissao, ua.loja_id, p.exige_mfa,
         (not p.exige_mfa or privado.sessao_aal2())
    from public.usuario_atribuicoes ua
    join public.usuarios u          on u.id = ua.usuario_id
    join public.perfil_permissoes pp on pp.perfil_id = ua.perfil_id
    join public.permissoes p         on p.codigo = pp.permissao
   where ua.usuario_id = auth.uid()
     and u.ativo and ua.ativo
     and (ua.valido_ate is null or ua.valido_ate > now());
$$;
revoke all on function public.minhas_permissoes() from public, anon;
grant execute on function public.minhas_permissoes() to authenticated;

-- ---------------------------------------------------------------------
-- RLS das tabelas de acesso e estrutura
-- ---------------------------------------------------------------------
alter table public.empresas            enable row level security;
alter table public.lojas               enable row level security;
alter table public.cargos              enable row level security;
alter table public.departamentos       enable row level security;
alter table public.usuarios            enable row level security;
alter table public.perfis              enable row level security;
alter table public.permissoes          enable row level security;
alter table public.perfil_permissoes   enable row level security;
alter table public.usuario_atribuicoes enable row level security;

-- Empresas: leitura para quem atua em alguma loja da empresa; gestão por config
create policy empresas_ler on public.empresas for select to authenticated
  using (
    privado.pode('config.estrutura.gerir')
    or exists (select 1 from public.lojas l
                where l.empresa_id = empresas.id
                  and privado.pode('colaborador.ler', l.id))
  );
create policy empresas_gerir_ins on public.empresas for insert to authenticated
  with check (privado.pode('config.estrutura.gerir'));
create policy empresas_gerir_upd on public.empresas for update to authenticated
  using (privado.pode('config.estrutura.gerir'))
  with check (privado.pode('config.estrutura.gerir'));

-- Lojas: cada um vê as lojas em que atua; gestão por config (global)
create policy lojas_ler on public.lojas for select to authenticated
  using (privado.pode('config.estrutura.gerir') or privado.pode('colaborador.ler', id));
create policy lojas_gerir_ins on public.lojas for insert to authenticated
  with check (privado.pode('config.estrutura.gerir'));
create policy lojas_gerir_upd on public.lojas for update to authenticated
  using (privado.pode('config.estrutura.gerir'))
  with check (privado.pode('config.estrutura.gerir'));

-- Cargos / departamentos: leitura para qualquer usuário autenticado e ativo
create policy cargos_ler on public.cargos for select to authenticated
  using (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo));
create policy cargos_gerir_ins on public.cargos for insert to authenticated
  with check (privado.pode('config.estrutura.gerir'));
create policy cargos_gerir_upd on public.cargos for update to authenticated
  using (privado.pode('config.estrutura.gerir')) with check (privado.pode('config.estrutura.gerir'));

create policy departamentos_ler on public.departamentos for select to authenticated
  using (exists (select 1 from public.usuarios u where u.id = auth.uid() and u.ativo));
create policy departamentos_gerir_ins on public.departamentos for insert to authenticated
  with check (privado.pode('config.estrutura.gerir'));
create policy departamentos_gerir_upd on public.departamentos for update to authenticated
  using (privado.pode('config.estrutura.gerir')) with check (privado.pode('config.estrutura.gerir'));

-- Usuários: cada um vê a si; gestores de acesso veem todos
create policy usuarios_ler on public.usuarios for select to authenticated
  using (id = auth.uid() or privado.pode('acesso.gerir'));
-- criação/desativação de usuários: somente via função/edge function (service role)

-- Catálogo de perfis/permissões: leitura para quem gere acesso
create policy perfis_ler on public.perfis for select to authenticated
  using (privado.pode('acesso.gerir'));
create policy permissoes_ler on public.permissoes for select to authenticated
  using (privado.pode('acesso.gerir'));
create policy perfil_permissoes_ler on public.perfil_permissoes for select to authenticated
  using (privado.pode('acesso.gerir'));

-- Atribuições: o usuário vê as próprias; gestores veem todas.
-- Escrita somente pelas funções conceder_acesso / revogar_acesso.
create policy atribuicoes_ler on public.usuario_atribuicoes for select to authenticated
  using (usuario_id = auth.uid() or privado.pode('acesso.gerir'));

-- ---------------------------------------------------------------------
-- Concessão e revogação de acesso (auditadas, sem autoconcessão)
-- ---------------------------------------------------------------------
create or replace function public.conceder_acesso(
  p_usuario uuid, p_perfil_codigo text, p_loja uuid default null, p_motivo text default null,
  p_valido_ate timestamptz default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_perfil uuid; v_id uuid;
begin
  if not privado.pode('acesso.gerir') then
    raise exception 'Sem permissão para conceder acessos' using errcode = '42501';
  end if;
  if p_usuario = auth.uid() then
    raise exception 'Não é permitido conceder acesso a si mesmo' using errcode = '42501';
  end if;
  select id into v_perfil from public.perfis where codigo = p_perfil_codigo;
  if v_perfil is null then raise exception 'Perfil % não existe', p_perfil_codigo; end if;
  if p_perfil_codigo = 'gerente_loja' and p_loja is null then
    raise exception 'Gerente de loja precisa de uma loja definida';
  end if;
  insert into public.usuario_atribuicoes (usuario_id, perfil_id, loja_id, concedido_por, motivo, valido_ate)
  values (p_usuario, v_perfil, p_loja, auth.uid(), p_motivo, p_valido_ate)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.revogar_acesso(p_atribuicao uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not privado.pode('acesso.gerir') then
    raise exception 'Sem permissão para revogar acessos' using errcode = '42501';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da revogação';
  end if;
  update public.usuario_atribuicoes
     set ativo = false, revogado_por = auth.uid(), revogado_em = now(), motivo = p_motivo
   where id = p_atribuicao and ativo;
  if not found then raise exception 'Atribuição não encontrada ou já revogada'; end if;
end $$;

revoke all on function public.conceder_acesso(uuid, text, uuid, text, timestamptz) from public, anon;
revoke all on function public.revogar_acesso(uuid, text) from public, anon;
grant execute on function public.conceder_acesso(uuid, text, uuid, text, timestamptz) to authenticated;
grant execute on function public.revogar_acesso(uuid, text) to authenticated;
