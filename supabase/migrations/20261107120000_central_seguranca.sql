-- CENTRAL IDEALIZE: segurança da sessão igual ao painel de IA (pedido do Diego em 07/11/2026)
--  • verificação em duas etapas (app autenticador) obrigatória para todos no Central;
--  • senha + código de novo a cada N dias (padrão 7) no mesmo aparelho;
--  • sai sozinho após N horas sem uso (padrão 12).
-- Os valores ficam em central.config e são alterados pelo próprio Diego na aba Segurança da Gestão de acessos
-- (só gestor, com auditoria). A regra também é conferida aqui no banco: sem o código confirmado (aal2) ou com o
-- código confirmado há mais de N dias, o menu e a entrada nos sistemas (central_meu_acesso) não devolvem nada.
-- Vale só para o Central: o login direto do RH continua com a regra dele (mfa_obrigatorio).

create table if not exists central.config (
  id text primary key,
  valor text not null,
  atualizado_por uuid default auth.uid(),
  atualizado_em timestamptz not null default now()
);
alter table central.config enable row level security;
revoke all on central.config from anon, authenticated;
create trigger auditar after insert or update or delete on central.config for each row execute function privado.auditar();

insert into central.config (id, valor) values ('2fa_obrigatorio', 'true'), ('sessao_dias', '7'), ('inatividade_horas', '12')
on conflict (id) do nothing;

create or replace function privado.central_cfg(p_id text, p_padrao text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.valor from central.config c where c.id = p_id), p_padrao);
$$;

-- regras que valem para a pessoa logada
create or replace function privado.central_regras(p_usuario uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'exige_2fa', privado.central_cfg('2fa_obrigatorio', 'true')::boolean
                 or coalesce((select u.mfa_obrigatorio from public.usuarios u where u.id = p_usuario), false),
    'dias', greatest(least(coalesce(nullif(privado.central_cfg('sessao_dias', '7'), '')::int, 7), 90), 1),
    'horas', greatest(least(coalesce(nullif(privado.central_cfg('inatividade_horas', '12'), '')::int, 12), 72), 1)
  );
$$;

-- a sessão atual cumpre as regras? (2FA confirmado e dentro do prazo de dias)
create or replace function privado.central_sessao_ok() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_r jsonb := privado.central_regras(auth.uid()); v_totp timestamptz;
begin
  if not (v_r->>'exige_2fa')::boolean then return true; end if;
  if coalesce(auth.jwt()->>'aal', '') <> 'aal2' then return false; end if;
  select to_timestamp(max((m->>'timestamp')::bigint)) into v_totp
    from jsonb_array_elements(case when jsonb_typeof(auth.jwt()->'amr') = 'array' then auth.jwt()->'amr' else '[]'::jsonb end) m
   where m->>'method' = 'totp' and (m->>'timestamp') ~ '^\d+$';
  if v_totp is not null and v_totp < now() - make_interval(days => (v_r->>'dias')::int) then return false; end if;
  return true;
end $$;

-- a tela pergunta as regras antes de mostrar qualquer coisa (vale mesmo sem o 2FA confirmado)
create or replace function public.central_regras_sessao() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null then null else privado.central_regras(auth.uid()) end;
$$;

-- gestor também precisa da sessão em dia
create or replace function privado.central_gestor() returns boolean
language sql stable security definer set search_path = '' as $$
  select privado.pode('acesso.gerir', null) and privado.central_sessao_ok();
$$;

create or replace function public.central_menu()
returns table(chave text, nome text, descricao text, url text, cor text, icone text, ordem integer, situacao text, tipo_acesso text, abrir_em text, conta text)
language sql stable security definer set search_path = '' as $$
  select s.chave, s.nome, s.descricao, s.url, s.cor, s.icone, s.ordem, s.situacao, s.tipo_acesso, s.abrir_em, a.conta
    from central.sistemas s
    left join central.acessos a on a.sistema = s.chave and a.usuario_id = auth.uid() and a.ativo
   where privado.central_liberado(auth.uid())
     and privado.central_sessao_ok()
     and s.situacao <> 'oculto'
     and case
           when s.situacao = 'em_breve' then privado.central_gestor()
           when s.tipo_acesso = 'rh' then exists (
             select 1 from public.usuario_atribuicoes ua join public.perfis p on p.id = ua.perfil_id
              where ua.usuario_id = auth.uid() and ua.ativo and p.codigo <> 'colaborador'
                and (ua.valido_ate is null or ua.valido_ate > now()))
           else a.id is not null
         end
   order by s.ordem, s.nome;
$$;

create or replace function public.central_meu_acesso(p_sistema text)
returns table(conta text, nome text, email text)
language sql stable security definer set search_path = '' as $$
  select a.conta, u.nome, u.email
    from central.acessos a
    join central.sistemas s on s.chave = a.sistema and s.situacao = 'ativo' and s.tipo_acesso = 'login'
    join public.usuarios u on u.id = a.usuario_id
   where a.usuario_id = auth.uid() and a.sistema = p_sistema and a.ativo
     and a.conta is not null
     and privado.central_liberado(auth.uid())
     and privado.central_sessao_ok();
$$;

-- aba Segurança: regras + quem já cadastrou o autenticador
create or replace function public.central_seguranca() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not privado.central_gestor() then raise exception 'Sem permissão para gerir acessos' using errcode = '42501'; end if;
  return jsonb_build_object(
    'obrigatorio', privado.central_cfg('2fa_obrigatorio', 'true')::boolean,
    'dias', (privado.central_regras(auth.uid())->>'dias')::int,
    'horas', (privado.central_regras(auth.uid())->>'horas')::int,
    'pessoas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', u.id, 'nome', u.nome, 'email', u.email, 'eu', u.id = auth.uid(),
               'tem_2fa', exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified'))
             order by u.nome)
        from public.usuarios u where u.ativo and privado.central_liberado(u.id)), '[]'::jsonb)
  );
end $$;

create or replace function public.central_seguranca_salvar(p_obrigatorio boolean, p_dias integer, p_horas integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not privado.central_gestor() then raise exception 'Sem permissão para gerir acessos' using errcode = '42501'; end if;
  if p_dias is null or p_dias < 1 or p_dias > 90 then raise exception 'Informe de 1 a 90 dias'; end if;
  if p_horas is null or p_horas < 1 or p_horas > 72 then raise exception 'Informe de 1 a 72 horas'; end if;
  insert into central.config (id, valor, atualizado_por, atualizado_em) values
    ('2fa_obrigatorio', coalesce(p_obrigatorio, true)::text, auth.uid(), now()),
    ('sessao_dias', p_dias::text, auth.uid(), now()),
    ('inatividade_horas', p_horas::text, auth.uid(), now())
  on conflict (id) do update set valor = excluded.valor, atualizado_por = excluded.atualizado_por, atualizado_em = excluded.atualizado_em
   where central.config.valor is distinct from excluded.valor;
end $$;

revoke all on function public.central_regras_sessao() from public, anon;
revoke all on function public.central_seguranca() from public, anon;
revoke all on function public.central_seguranca_salvar(boolean, integer, integer) from public, anon;
grant execute on function public.central_regras_sessao() to authenticated;
grant execute on function public.central_seguranca() to authenticated;
grant execute on function public.central_seguranca_salvar(boolean, integer, integer) to authenticated;
revoke all on function privado.central_cfg(text, text), privado.central_regras(uuid), privado.central_sessao_ok() from public, anon, authenticated;
