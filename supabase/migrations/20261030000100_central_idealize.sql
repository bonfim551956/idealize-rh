-- CENTRAL IDEALIZE: login único (e-mail e senha deste projeto) para todos os sistemas.
-- O cadastro de quem entra em qual sistema fica aqui, junto do RH.
-- Tabelas no schema "central" (fora da API); leitura e escrita só pelas funções abaixo.

create schema if not exists central;
revoke all on schema central from public, anon, authenticated;

create table central.sistemas (
  chave          text primary key check (chave ~ '^[a-z0-9_]{2,30}$'),
  nome           text not null check (length(trim(nome)) >= 2),
  descricao      text,
  url            text check (url is null or url ~ '^https://[^\s]+$'),
  cor            text not null default '#0B6E71' check (cor ~ '^#[0-9A-Fa-f]{6}$'),
  icone          text not null default 'app',
  ordem          integer not null default 0,
  -- ativo: aparece e abre; em_breve: aparece desabilitado só para quem gere acessos; oculto: não aparece
  situacao       text not null default 'ativo' check (situacao in ('ativo','em_breve','oculto')),
  -- login: precisa informar a conta da pessoa naquele sistema; rh: acesso vem dos perfis do próprio RH
  tipo_acesso    text not null default 'login' check (tipo_acesso in ('login','rh')),
  atualizado_por uuid,
  atualizado_em  timestamptz not null default now()
);

create table central.acessos (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null references public.usuarios(id),
  sistema       text not null references central.sistemas(chave),
  conta         text,                       -- login da pessoa no sistema (ex.: usuário do PDV)
  ativo         boolean not null default true,
  concedido_por uuid,
  concedido_em  timestamptz not null default now(),
  revogado_por  uuid,
  revogado_em   timestamptz,
  motivo        text
);
create unique index acessos_um_ativo on central.acessos (usuario_id, sistema) where ativo;
create index acessos_usuario on central.acessos (usuario_id);

alter table central.sistemas enable row level security;
alter table central.acessos  enable row level security;

create trigger a_maiusculas before insert or update on central.acessos
  for each row execute function privado.maiusculas('conta', 'motivo');
create trigger auditar after insert or update or delete on central.acessos
  for each row execute function privado.auditar();
create trigger auditar after insert or update or delete on central.sistemas
  for each row execute function privado.auditar();

insert into central.sistemas (chave, nome, descricao, url, cor, icone, ordem, situacao, tipo_acesso) values
  ('pdv',    'PDV',            'Vendas, OS, recebimentos, caixa e demonstração de lentes', 'https://pdv-idealize.vercel.app',        '#0B6E71', 'carrinho',   1, 'ativo',    'login'),
  ('adm',    'Sistema ADM',    'Fechamento de caixa, crediário, estoque e pós-venda',       null,                                     '#2D5C88', 'grafico',    2, 'em_breve', 'login'),
  ('rh',     'Idealize RH',    'Colaboradores, documentos, férias, uniformes e alertas',   'https://rh.oticasidealize.online',       '#7A4FA0', 'pessoas',    3, 'ativo',    'rh'),
  ('p360',   'Plataforma 360', 'Metas, ranking e indicadores',                               null,                                     '#A3560F', 'alvo',       4, 'em_breve', 'login'),
  ('agenda', 'Agendamento',    'Agenda da clínica, pacientes e receitas',                  'https://clinica-visao-ideal.vercel.app', '#1E7A3C', 'calendario', 5, 'ativo',    'login');

-- ---------------------------------------------------------------------------
-- Regras auxiliares
-- ---------------------------------------------------------------------------

-- quem gere acessos no Central: a mesma permissão do RH (acesso.gerir em todas as lojas, com MFA)
create or replace function privado.central_gestor()
returns boolean language sql stable security definer set search_path = '' as $$
  select privado.pode('acesso.gerir', null);  -- só atribuições sem loja (todas as lojas)
$$;

-- a pessoa pode usar o Central: usuário ativo e, se ligada a um colaborador, com vínculo que não esteja encerrado
create or replace function privado.central_liberado(p_usuario uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.usuarios u
     where u.id = p_usuario and u.ativo
       and (u.colaborador_id is null
            or exists (select 1 from public.vinculos v
                        where v.colaborador_id = u.colaborador_id
                          and v.status not in ('desligado','arquivado')))
  );
$$;

-- ---------------------------------------------------------------------------
-- Funções usadas pelo Central (API)
-- ---------------------------------------------------------------------------

-- sistemas que aparecem no menu de quem está logado
create or replace function public.central_meus_sistemas()
returns table (chave text, nome text, descricao text, url text, cor text, icone text, ordem integer,
               situacao text, tipo_acesso text, conta text)
language sql stable security definer set search_path = '' as $$
  select s.chave, s.nome, s.descricao, s.url, s.cor, s.icone, s.ordem, s.situacao, s.tipo_acesso, a.conta
    from central.sistemas s
    left join central.acessos a on a.sistema = s.chave and a.usuario_id = auth.uid() and a.ativo
   where privado.central_liberado(auth.uid())
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

-- usada pelos outros sistemas (com o token de quem está logado) para saber com qual conta a pessoa entra
create or replace function public.central_meu_acesso(p_sistema text)
returns table (conta text, nome text, email text)
language sql stable security definer set search_path = '' as $$
  select a.conta, u.nome, u.email
    from central.acessos a
    join central.sistemas s on s.chave = a.sistema and s.situacao = 'ativo' and s.tipo_acesso = 'login'
    join public.usuarios u on u.id = a.usuario_id
   where a.usuario_id = auth.uid() and a.sistema = p_sistema and a.ativo
     and a.conta is not null
     and privado.central_liberado(auth.uid());
$$;

create or replace function public.central_sou_gestor()
returns boolean language sql stable security definer set search_path = '' as $$
  select privado.central_gestor();
$$;

-- lista para a tela de Gestão de acessos
create or replace function public.central_listar_acessos()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not privado.central_gestor() then
    raise exception 'Sem permissão para gerir acessos (exige verificação em duas etapas)' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'sistemas', (select coalesce(jsonb_agg(to_jsonb(s) order by s.ordem), '[]') from central.sistemas s),
    'usuarios', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', u.id, 'nome', u.nome, 'email', u.email, 'ativo', u.ativo,
        'liberado', privado.central_liberado(u.id),
        'convite_pendente', (au.last_sign_in_at is null),
        'perfis_rh', (select coalesce(jsonb_agg(jsonb_build_object('perfil', p.nome, 'loja', l.nome)), '[]')
                        from public.usuario_atribuicoes ua join public.perfis p on p.id = ua.perfil_id
                        left join public.lojas l on l.id = ua.loja_id
                       where ua.usuario_id = u.id and ua.ativo and p.codigo <> 'colaborador'),
        'acessos', (select coalesce(jsonb_agg(jsonb_build_object('sistema', a.sistema, 'conta', a.conta,
                                   'concedido_em', a.concedido_em)), '[]')
                      from central.acessos a where a.usuario_id = u.id and a.ativo)
      ) order by u.nome), '[]')
      from public.usuarios u left join auth.users au on au.id = u.id
    )
  );
end $$;

create or replace function public.central_conceder(p_usuario uuid, p_sistema text, p_conta text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_tipo text; v_conta text := nullif(trim(coalesce(p_conta, '')), '');
begin
  if not privado.central_gestor() then
    raise exception 'Sem permissão para gerir acessos' using errcode = '42501';
  end if;
  select s.tipo_acesso into v_tipo from central.sistemas s where s.chave = p_sistema;
  if v_tipo is null then raise exception 'Sistema inexistente'; end if;
  if v_tipo = 'rh' then raise exception 'O acesso ao RH é dado pelos perfis do próprio RH'; end if;
  if v_conta is null then raise exception 'Informe o login da pessoa neste sistema'; end if;
  if not exists (select 1 from public.usuarios u where u.id = p_usuario and u.ativo) then
    raise exception 'Usuário inexistente ou inativo';
  end if;
  if exists (select 1 from central.acessos a where a.sistema = p_sistema and a.ativo
               and upper(a.conta) = upper(v_conta) and a.usuario_id <> p_usuario) then
    raise exception 'Este login já está ligado a outra pessoa';
  end if;
  update central.acessos set ativo = false, revogado_por = auth.uid(), revogado_em = now(), motivo = 'SUBSTITUÍDO'
   where usuario_id = p_usuario and sistema = p_sistema and ativo;
  insert into central.acessos (usuario_id, sistema, conta, concedido_por)
  values (p_usuario, p_sistema, v_conta, auth.uid());
end $$;

create or replace function public.central_revogar(p_usuario uuid, p_sistema text, p_motivo text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not privado.central_gestor() then
    raise exception 'Sem permissão para gerir acessos' using errcode = '42501';
  end if;
  update central.acessos set ativo = false, revogado_por = auth.uid(), revogado_em = now(),
         motivo = coalesce(nullif(trim(p_motivo), ''), 'RETIRADO NA GESTÃO DE ACESSOS')
   where usuario_id = p_usuario and sistema = p_sistema and ativo;
end $$;

-- editar nome, endereço, ordem e situação dos sistemas (tela própria, só gestor)
create or replace function public.central_salvar_sistema(p_chave text, p_nome text, p_descricao text, p_url text,
                                                         p_ordem integer, p_situacao text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not privado.central_gestor() then
    raise exception 'Sem permissão para gerir acessos' using errcode = '42501';
  end if;
  update central.sistemas
     set nome = trim(p_nome), descricao = nullif(trim(coalesce(p_descricao, '')), ''),
         url = nullif(trim(coalesce(p_url, '')), ''), ordem = coalesce(p_ordem, ordem),
         situacao = p_situacao, atualizado_por = auth.uid(), atualizado_em = now()
   where chave = p_chave;
  if not found then raise exception 'Sistema inexistente'; end if;
end $$;

-- Desligamento concluído no RH: retira todos os acessos do Central da pessoa
create or replace function privado.central_desligamento()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('desligado','arquivado') and old.status is distinct from new.status
     and not exists (select 1 from public.vinculos v where v.colaborador_id = new.colaborador_id
                       and v.id <> new.id and v.status not in ('desligado','arquivado')) then
    update central.acessos a set ativo = false, revogado_em = now(), motivo = 'DESLIGAMENTO'
      from public.usuarios u
     where u.colaborador_id = new.colaborador_id and a.usuario_id = u.id and a.ativo;
  end if;
  return new;
end $$;
create trigger central_desligamento after update of status on public.vinculos
  for each row execute function privado.central_desligamento();

revoke all on function public.central_meus_sistemas(), public.central_meu_acesso(text), public.central_sou_gestor(),
  public.central_listar_acessos(), public.central_conceder(uuid, text, text), public.central_revogar(uuid, text, text),
  public.central_salvar_sistema(text, text, text, text, integer, text) from public, anon;
grant execute on function public.central_meus_sistemas(), public.central_meu_acesso(text), public.central_sou_gestor(),
  public.central_listar_acessos(), public.central_conceder(uuid, text, text), public.central_revogar(uuid, text, text),
  public.central_salvar_sistema(text, text, text, text, integer, text) to authenticated;
revoke all on function privado.central_gestor(), privado.central_liberado(uuid), privado.central_desligamento() from public, anon, authenticated;
