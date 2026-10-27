-- =====================================================================
-- IDEALIZE RH 360º — Controle de ausências e Vale-transporte
--
-- Regras combinadas com a diretoria (27/10/2026):
--  * Dias de VT do mês = todos os dias, exceto domingos, 25/12 e 01/01.
--  * Pagamento ANTECIPADO: o VT do mês M paga os dias de M e desconta as
--    ausências do mês anterior (M-1).
--  * Ausências que já se sabe que vão cair em M (férias, afastamento,
--    licença registrados) saem direto do próprio mês M — e não são
--    descontadas de novo no mês seguinte (o fechamento guarda o que já
--    foi excluído).
--  * Tiram dias: falta injustificada, atestado, afastamento, licença, férias.
--    Declaração de horas NÃO desconta.
--  * Valor = dias × valor diário de cada colaborador (cadastro do VT).
--  * Desconto de 6% do salário: fora do escopo por enquanto.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
insert into public.permissoes (codigo, modulo, descricao, exige_mfa, sensivel) values
  ('ausencia.ler',       'ausencias', 'Ver faltas, atestados, afastamentos, licenças e férias registrados', false, true),
  ('ausencia.registrar', 'ausencias', 'Registrar e cancelar ausências',                                     false, true),
  ('vt.ler',             'vt',        'Ver cadastro e cálculo do vale-transporte',                          false, false),
  ('vt.gerir',           'vt',        'Cadastrar valor diário do VT e fechar o mês',                        false, false)
on conflict (codigo) do nothing;

insert into public.perfil_permissoes (perfil_id, permissao)
select p.id, x from public.perfis p,
  unnest(array['ausencia.ler', 'ausencia.registrar', 'vt.ler', 'vt.gerir']) x
 where p.codigo in ('diretoria', 'rh_central', 'departamento_pessoal')
on conflict do nothing;
insert into public.perfil_permissoes (perfil_id, permissao)
select p.id, 'vt.ler' from public.perfis p where p.codigo = 'contabilidade'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Ausências
-- ---------------------------------------------------------------------
create type public.ausencia_tipo as enum (
  'falta_injustificada', 'atestado', 'afastamento', 'licenca', 'ferias', 'declaracao_horas'
);

create table public.ausencias (
  id                 uuid primary key default gen_random_uuid(),
  colaborador_id     uuid not null references public.colaboradores(id) on delete restrict,
  tipo               public.ausencia_tipo not null,
  data_inicio        date not null,
  data_fim           date not null,
  horario            text check (horario is null or length(horario) <= 60),   -- declaração de horas (ex.: 15H10 ÀS 16H)
  aquisitivo_inicio  date,                                                     -- férias: início do período aquisitivo
  observacao         text check (observacao is null or length(observacao) <= 500),
  documento_id       uuid references public.documentos(id) on delete set null,
  cancelada          boolean not null default false,
  cancelada_motivo   text,
  cancelada_por      uuid references public.usuarios(id),
  cancelada_em       timestamptz,
  criado_por         uuid references public.usuarios(id) default auth.uid(),
  criado_em          timestamptz not null default now(),
  check (data_fim >= data_inicio),
  check (data_fim - data_inicio <= 400),
  check (tipo <> 'declaracao_horas' or data_fim = data_inicio)
);
create index on public.ausencias (colaborador_id, data_inicio);
create index on public.ausencias (data_inicio, data_fim) where not cancelada;

create trigger a_maiusculas before insert or update on public.ausencias
  for each row execute function privado.maiusculas('horario', 'observacao', 'cancelada_motivo');
create trigger auditar after insert or update or delete on public.ausencias
  for each row execute function privado.auditar();

-- só as funções próprias alteram (cancelamento); nada é apagado
create or replace function privado.travar_ausencia()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Ausências não são apagadas; cancele com motivo'; end if;
  if coalesce(current_setting('idealize.via_funcao', true), '') <> 'ausencia' then
    raise exception 'Ausências só mudam pelas funções próprias' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger travar before update or delete on public.ausencias
  for each row execute function privado.travar_ausencia();

alter table public.ausencias enable row level security;
create policy ausencias_ler on public.ausencias for select to authenticated
  using (privado.pode('ausencia.ler', privado.loja_do_colaborador(colaborador_id)));
revoke insert, update, delete, truncate on public.ausencias from anon, authenticated;
revoke all on public.ausencias from anon;

-- ---------------------------------------------------------------------
-- Cadastro do VT (um por colaborador)
-- ---------------------------------------------------------------------
create table public.vt_cadastros (
  colaborador_id  uuid primary key references public.colaboradores(id) on delete restrict,
  recebe          boolean not null default true,
  valor_diario    numeric(8,2) check (valor_diario is null or valor_diario between 0.01 and 500),
  observacao      text check (observacao is null or length(observacao) <= 300),
  atualizado_por  uuid references public.usuarios(id) default auth.uid(),
  atualizado_em   timestamptz not null default now(),
  check (not recebe or valor_diario is not null)
);
create trigger a_maiusculas before insert or update on public.vt_cadastros
  for each row execute function privado.maiusculas('observacao');
create trigger auditar after insert or update or delete on public.vt_cadastros
  for each row execute function privado.auditar();
alter table public.vt_cadastros enable row level security;
create policy vt_cadastros_ler on public.vt_cadastros for select to authenticated
  using (privado.pode('vt.ler', privado.loja_do_colaborador(colaborador_id)));
revoke insert, update, delete, truncate on public.vt_cadastros from anon, authenticated;
revoke all on public.vt_cadastros from anon;

-- ---------------------------------------------------------------------
-- Fechamento do mês (o que foi efetivamente pago)
-- ---------------------------------------------------------------------
create table public.vt_fechamentos (
  id                     uuid primary key default gen_random_uuid(),
  mes                    date not null check (extract(day from mes) = 1),
  colaborador_id         uuid not null references public.colaboradores(id) on delete restrict,
  loja_id                uuid not null references public.lojas(id),
  valor_diario           numeric(8,2) not null,
  dias_base              int not null,
  dias_excluidos         int not null default 0,   -- ausências do próprio mês já tiradas no pagamento
  dias_desconto_anterior int not null default 0,
  dias_pagos             int not null,
  valor                  numeric(10,2) not null,
  origem                 text not null default 'sistema' check (origem in ('sistema', 'planilha')),
  observacao             text,
  fechado_por            uuid references public.usuarios(id) default auth.uid(),
  fechado_em             timestamptz not null default now(),
  unique (mes, colaborador_id)
);
create trigger auditar after insert or update or delete on public.vt_fechamentos
  for each row execute function privado.auditar();
alter table public.vt_fechamentos enable row level security;
create policy vt_fechamentos_ler on public.vt_fechamentos for select to authenticated
  using (privado.pode('vt.ler', loja_id));
revoke insert, update, delete, truncate on public.vt_fechamentos from anon, authenticated;
revoke all on public.vt_fechamentos from anon;

-- ---------------------------------------------------------------------
-- Calendário do VT
-- ---------------------------------------------------------------------
create or replace function privado.dia_vt(d date)
returns boolean language sql immutable set search_path = '' as $$
  select extract(isodow from d) <> 7 and to_char(d, 'MM-DD') not in ('12-25', '01-01');
$$;

create or replace function privado.dias_vt(p_ini date, p_fim date)
returns int language sql immutable set search_path = '' as $$
  select case when p_ini is null or p_fim is null or p_fim < p_ini then 0
              else (select count(*)::int from generate_series(p_ini, p_fim, interval '1 day') d
                     where privado.dia_vt(d::date)) end;
$$;

-- dias (contáveis no VT) cobertos por ausências dos tipos pedidos, sem contar o mesmo dia duas vezes.
-- Férias antigas (importadas da ficha) vêm da linha do tempo.
create or replace function privado.dias_ausencia(p_colaborador uuid, p_tipos text[], p_ini date, p_fim date)
returns int language sql stable security definer set search_path = '' as $$
  with faixas as (
    select greatest(a.data_inicio, p_ini) as i, least(a.data_fim, p_fim) as f
      from public.ausencias a
     where a.colaborador_id = p_colaborador and not a.cancelada
       and a.tipo::text = any (p_tipos)
       and a.data_inicio <= p_fim and a.data_fim >= p_ini
    union all
    select greatest(x.gi, p_ini), least(x.gf, p_fim)
      from (select to_date(substring(t.titulo from '(?i)de (\d{2}/\d{2}/\d{4}) a'), 'DD/MM/YYYY') as gi,
                   to_date(substring(t.titulo from '(?i) a (\d{2}/\d{2}/\d{4})'), 'DD/MM/YYYY') as gf
              from public.eventos_timeline t
             where t.colaborador_id = p_colaborador and t.tipo = 'ferias' and 'ferias' = any (p_tipos)) x
     where x.gi is not null and x.gf is not null and x.gi <= p_fim and x.gf >= p_ini
  )
  select case when p_ini is null or p_fim is null or p_fim < p_ini then 0 else
    (select count(distinct d)::int
       from faixas, generate_series(faixas.i, faixas.f, interval '1 day') d
      where faixas.f >= faixas.i and privado.dia_vt(d::date)) end;
$$;
revoke all on function privado.dias_ausencia(uuid, text[], date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Cálculo do mês
-- ---------------------------------------------------------------------
create or replace function public.vt_calculo(p_mes date, p_loja uuid default null)
returns table (
  colaborador_id uuid, nome text, loja_id uuid, loja text, cargo text,
  situacao text,                 -- 'recebe' | 'nao_recebe' | 'sem_cadastro'
  valor_diario numeric, periodo_inicio date, periodo_fim date,
  dias_base int, dias_excluidos int, ausencias_mes_anterior int, ja_descontado int,
  dias_desconto_anterior int, dias_pagar int, valor numeric,
  fechado boolean, fechado_dias int, fechado_valor numeric, observacao text)
language sql stable security definer set search_path = '' as $$
  with par as (
    select date_trunc('month', p_mes)::date as m_ini,
           (date_trunc('month', p_mes) + interval '1 month - 1 day')::date as m_fim,
           (date_trunc('month', p_mes) - interval '1 month')::date as a_ini,
           (date_trunc('month', p_mes) - interval '1 day')::date as a_fim
  ),
  vinc as (
    select distinct on (v.colaborador_id)
           v.colaborador_id, v.data_admissao, v.data_desligamento, v.cargo_id
      from public.vinculos v, par
     where v.data_admissao is not null and v.data_admissao <= par.m_fim
       and v.status <> 'arquivado'
       and (v.status <> 'desligado' or v.data_desligamento >= par.a_ini)
     order by v.colaborador_id, v.data_admissao desc
  ),
  base as (
    select c.id, coalesce(c.nome_social, c.nome_completo) as nome, c.loja_atual_id, l.nome as loja, cg.nome as cargo,
           vt.recebe, vt.valor_diario, vt.observacao,
           greatest(par.m_ini, vi.data_admissao) as wi,
           least(par.m_fim, coalesce(vi.data_desligamento, par.m_fim)) as wf,
           greatest(par.a_ini, vi.data_admissao) as pi,
           least(par.a_fim, coalesce(vi.data_desligamento, par.a_fim)) as pf,
           par.m_ini, par.a_ini
      from vinc vi
      join public.colaboradores c on c.id = vi.colaborador_id
      join public.lojas l on l.id = c.loja_atual_id
      left join public.cargos cg on cg.id = vi.cargo_id
      left join public.vt_cadastros vt on vt.colaborador_id = c.id
      cross join par
     where (p_loja is null or c.loja_atual_id = p_loja)
       and privado.pode('vt.ler', c.loja_atual_id)
  ),
  conta as (
    select b.*,
           privado.dias_vt(b.wi, b.wf) as d_base,
           privado.dias_ausencia(b.id, array['ferias','afastamento','licenca'], b.wi, b.wf) as d_excl,
           privado.dias_ausencia(b.id, array['falta_injustificada','atestado','afastamento','licenca','ferias'], b.pi, b.pf) as d_aus_ant,
           coalesce((select f.dias_excluidos from public.vt_fechamentos f
                      where f.mes = b.a_ini and f.colaborador_id = b.id), 0) as d_ja
      from base b
  )
  select k.id, k.nome, k.loja_atual_id, k.loja, k.cargo,
         case when k.recebe is null then 'sem_cadastro' when k.recebe then 'recebe' else 'nao_recebe' end,
         k.valor_diario, k.wi, k.wf,
         k.d_base, k.d_excl, k.d_aus_ant, least(k.d_ja, k.d_aus_ant),
         greatest(0, k.d_aus_ant - k.d_ja),
         greatest(0, k.d_base - k.d_excl - greatest(0, k.d_aus_ant - k.d_ja)),
         case when k.recebe then round(greatest(0, k.d_base - k.d_excl - greatest(0, k.d_aus_ant - k.d_ja)) * k.valor_diario, 2) else 0 end,
         f.id is not null, f.dias_pagos, f.valor, k.observacao
    from conta k
    left join public.vt_fechamentos f on f.mes = k.m_ini and f.colaborador_id = k.id
   order by k.loja, k.nome;
$$;
revoke all on function public.vt_calculo(date, uuid) from public, anon;
grant execute on function public.vt_calculo(date, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Escrita (só por funções)
-- ---------------------------------------------------------------------
create or replace function public.vt_salvar(p_colaborador uuid, p_recebe boolean, p_valor_diario numeric, p_observacao text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_loja uuid := privado.loja_do_colaborador(p_colaborador);
begin
  if v_loja is null then raise exception 'Colaborador não encontrado'; end if;
  perform privado.exigir('vt.gerir', v_loja);
  if p_recebe and (p_valor_diario is null or p_valor_diario <= 0) then
    raise exception 'Informe o valor diário do VT';
  end if;
  insert into public.vt_cadastros (colaborador_id, recebe, valor_diario, observacao, atualizado_por, atualizado_em)
  values (p_colaborador, p_recebe, case when p_recebe then p_valor_diario end, nullif(trim(p_observacao), ''), auth.uid(), now())
  on conflict (colaborador_id) do update
     set recebe = excluded.recebe, valor_diario = excluded.valor_diario, observacao = excluded.observacao,
         atualizado_por = auth.uid(), atualizado_em = now();
end $$;
revoke all on function public.vt_salvar(uuid, boolean, numeric, text) from public, anon;
grant execute on function public.vt_salvar(uuid, boolean, numeric, text) to authenticated;

create or replace function public.ausencia_registrar(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_colab uuid := (privado.texto(p, 'colaborador_id'))::uuid;
  v_loja  uuid := privado.loja_do_colaborador(v_colab);
  v_tipo  public.ausencia_tipo := (privado.texto(p, 'tipo'))::public.ausencia_tipo;
  v_ini   date := (privado.texto(p, 'data_inicio'))::date;
  v_fim   date := coalesce((privado.texto(p, 'data_fim'))::date, (privado.texto(p, 'data_inicio'))::date);
  v_id    uuid;
  v_rot   text;
begin
  if v_loja is null then raise exception 'Colaborador não encontrado'; end if;
  perform privado.exigir('ausencia.registrar', v_loja);
  if v_tipo is null or v_ini is null then raise exception 'Informe o tipo e a data'; end if;
  if v_fim < v_ini then raise exception 'A data final é anterior à inicial'; end if;
  if v_tipo = 'declaracao_horas' and v_fim <> v_ini then raise exception 'Declaração de horas é de um único dia'; end if;
  if v_tipo = 'ferias' and privado.texto(p, 'aquisitivo_inicio') is null then raise exception 'Informe o início do período aquisitivo das férias'; end if;
  if exists (select 1 from public.ausencias a
              where a.colaborador_id = v_colab and not a.cancelada and a.tipo = v_tipo
                and a.data_inicio <= v_fim and a.data_fim >= v_ini and v_tipo <> 'declaracao_horas') then
    raise exception 'Já existe % registrado(a) nesse período para este colaborador', replace(v_tipo::text, '_', ' ');
  end if;

  insert into public.ausencias (colaborador_id, tipo, data_inicio, data_fim, horario, aquisitivo_inicio, observacao, documento_id)
  values (v_colab, v_tipo, v_ini, v_fim, privado.texto(p, 'horario'), (privado.texto(p, 'aquisitivo_inicio'))::date,
          privado.texto(p, 'observacao'), (privado.texto(p, 'documento_id'))::uuid)
  returning id into v_id;

  v_rot := case v_tipo
    when 'falta_injustificada' then 'FALTA INJUSTIFICADA'
    when 'atestado'            then 'ATESTADO'
    when 'afastamento'         then 'AFASTAMENTO'
    when 'licenca'             then 'LICENÇA'
    when 'ferias'              then 'FÉRIAS'
    else 'DECLARAÇÃO DE HORAS' end;
  perform privado.timeline(v_colab, null, 'ausencia', v_ini,
    v_rot || case when v_fim > v_ini then ' DE ' || to_char(v_ini, 'DD/MM/YYYY') || ' A ' || to_char(v_fim, 'DD/MM/YYYY')
                  else ' EM ' || to_char(v_ini, 'DD/MM/YYYY') end,
    case when v_tipo = 'ferias' and (privado.texto(p, 'aquisitivo_inicio')) is not null
         then 'PERÍODO AQUISITIVO ' || to_char((privado.texto(p, 'aquisitivo_inicio'))::date, 'DD/MM/YYYY') end,
    case when v_tipo in ('atestado', 'afastamento', 'licenca') then 'saude' else 'contratual' end);
  return v_id;
end $$;
revoke all on function public.ausencia_registrar(jsonb) from public, anon;
grant execute on function public.ausencia_registrar(jsonb) to authenticated;

create or replace function public.ausencia_cancelar(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  select a.*, privado.loja_do_colaborador(a.colaborador_id) as loja into v from public.ausencias a where a.id = p_id for update;
  if v.id is null then raise exception 'Ausência não encontrada'; end if;
  perform privado.exigir('ausencia.registrar', v.loja);
  if v.cancelada then raise exception 'Ausência já cancelada'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo do cancelamento'; end if;
  perform set_config('idealize.via_funcao', 'ausencia', true);
  update public.ausencias set cancelada = true, cancelada_motivo = trim(p_motivo),
         cancelada_por = auth.uid(), cancelada_em = now() where id = p_id;
  perform set_config('idealize.via_funcao', '', true);
  perform privado.timeline(v.colaborador_id, null, 'ausencia', current_date,
    'AUSÊNCIA CANCELADA (' || to_char(v.data_inicio, 'DD/MM/YYYY') || ')', upper(trim(p_motivo)),
    case when v.tipo in ('atestado', 'afastamento', 'licenca') then 'saude' else 'contratual' end);
end $$;
revoke all on function public.ausencia_cancelar(uuid, text) from public, anon;
grant execute on function public.ausencia_cancelar(uuid, text) to authenticated;

-- Fecha o mês: grava o que será pago (refazer substitui o fechamento anterior, fica na auditoria)
create or replace function public.vt_fechar(p_mes date, p_loja uuid default null, p_refazer boolean default false)
returns int language plpgsql security definer set search_path = '' as $$
declare v_mes date := date_trunc('month', p_mes)::date; n int;
begin
  if p_loja is null then perform privado.exigir('vt.gerir', null); else perform privado.exigir('vt.gerir', p_loja); end if;
  if exists (select 1 from public.vt_fechamentos f
              where f.mes = v_mes and (p_loja is null or f.loja_id = p_loja)) and not p_refazer then
    raise exception 'Este mês já foi fechado. Use "refazer fechamento" para substituir.';
  end if;
  delete from public.vt_fechamentos f where f.mes = v_mes and (p_loja is null or f.loja_id = p_loja);
  insert into public.vt_fechamentos (mes, colaborador_id, loja_id, valor_diario, dias_base, dias_excluidos,
                                     dias_desconto_anterior, dias_pagos, valor, observacao)
  select v_mes, c.colaborador_id, c.loja_id, c.valor_diario, c.dias_base, c.dias_excluidos,
         c.dias_desconto_anterior, c.dias_pagar, c.valor, c.observacao
    from public.vt_calculo(v_mes, p_loja) c
   where c.situacao = 'recebe';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.vt_fechar(date, uuid, boolean) from public, anon;
grant execute on function public.vt_fechar(date, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Leitura para a tela
-- ---------------------------------------------------------------------
create view public.v_ausencias with (security_invoker = true) as
select a.id, a.colaborador_id, coalesce(c.nome_social, c.nome_completo) as nome, c.loja_atual_id as loja_id, l.nome as loja,
       a.tipo, a.data_inicio, a.data_fim, a.horario, a.aquisitivo_inicio, a.observacao, a.documento_id,
       a.cancelada, a.cancelada_motivo, a.cancelada_em, a.criado_em,
       privado.dias_vt(a.data_inicio, a.data_fim) as dias_vt
  from public.ausencias a
  join public.colaboradores c on c.id = a.colaborador_id
  join public.lojas l on l.id = c.loja_atual_id;
revoke all on public.v_ausencias from anon, public;
grant select on public.v_ausencias to authenticated;
grant execute on function privado.dias_vt(date, date) to authenticated;
grant execute on function privado.dia_vt(date) to authenticated;

-- férias registradas aqui passam a contar também no aviso de férias do painel
create or replace function privado.ferias_gozo(p_colaboradores uuid[])
returns table (colaborador_id uuid, aq_ini date, g_ini date, g_fim date)
language sql stable security definer set search_path = '' as $$
  select t.colaborador_id,
         to_date(substring(t.descricao from '(?i)aquisitivo (\d{2}/\d{2}/\d{4})'), 'DD/MM/YYYY'),
         to_date(substring(t.titulo from '(?i)de (\d{2}/\d{2}/\d{4}) a'), 'DD/MM/YYYY'),
         to_date(substring(t.titulo from '(?i) a (\d{2}/\d{2}/\d{4})'), 'DD/MM/YYYY')
    from public.eventos_timeline t
   where t.tipo = 'ferias' and t.colaborador_id = any (p_colaboradores)
  union all
  select a.colaborador_id, a.aquisitivo_inicio, a.data_inicio, a.data_fim
    from public.ausencias a
   where a.tipo = 'ferias' and not a.cancelada and a.colaborador_id = any (p_colaboradores);
$$;
revoke all on function privado.ferias_gozo(uuid[]) from public, anon, authenticated;

-- painel: aviso de férias passa a somar as férias registradas como ausência
create or replace function public.painel_avisos(p_loja uuid default null)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with vis as (
    select c.id, c.nome_completo, c.nome_social, c.data_nascimento, c.loja_atual_id, l.nome as loja,
           v.id as vinculo_id, v.tipo, v.status, v.data_admissao,
           coalesce(cg.experiencia_dias_1, 15) as exp_d1, coalesce(cg.experiencia_dias_2, 15) as exp_d2
      from public.colaboradores c
      join public.lojas l on l.id = c.loja_atual_id
      join public.vinculos v on v.colaborador_id = c.id
      left join public.cargos cg on cg.id = v.cargo_id
     where v.status in ('ativo', 'em_ferias', 'afastado', 'em_licenca')
       and (p_loja is null or c.loja_atual_id = p_loja)
       and privado.pode('colaborador.ler', c.loja_atual_id)
  ),
  -- ---------------- experiência ----------------
  exper as (
    select x.*, (x.data_admissao + x.exp_d1 - 1) as fim_1, (x.data_admissao + x.exp_d1 + x.exp_d2 - 1) as fim_2
      from vis x where x.tipo = 'clt_experiencia' and x.data_admissao is not null
  ),
  exper_av as (
    select e.*,
           case when current_date <= e.fim_1 then 'primeiro'
                when current_date <= e.fim_2 then 'prorrogacao' else 'vencido' end as fase,
           case when current_date <= e.fim_1 then e.fim_1 else e.fim_2 end as termina_em
      from exper e
  ),
  -- ---------------- férias ----------------
  gozo as (
    select * from privado.ferias_gozo(array(select id from vis))
  ),
  periodos as (
    select x.id, x.nome_completo, x.nome_social, x.loja_atual_id, x.loja,
           (x.data_admissao + make_interval(years => k - 1))::date as aq_ini,
           (x.data_admissao + make_interval(years => k) - interval '1 day')::date as aq_fim
      from vis x
      cross join generate_series(1, 50) k
     where x.tipo::text like 'clt%' and x.data_admissao is not null
       and (x.data_admissao + make_interval(years => k) - interval '1 day')::date < current_date
  ),
  ferias as (
    select p.*, (p.aq_fim + interval '1 year')::date as concessivo_fim,
           least(30, coalesce(sum(greatest(0, g.g_fim - g.g_ini + 1)) filter (where g.g_ini is not null and g.g_fim is not null), 0))::int as dias_gozados
      from periodos p
      left join gozo g on g.colaborador_id = p.id and g.aq_ini = p.aq_ini
     group by p.id, p.nome_completo, p.nome_social, p.loja_atual_id, p.loja, p.aq_ini, p.aq_fim
  ),
  ferias_av as (
    select f.*, 30 - f.dias_gozados as saldo,
           (f.concessivo_fim - (30 - f.dias_gozados) + 1) as sair_ate
      from ferias f
     where f.dias_gozados < 30
       and f.concessivo_fim <= current_date + 90
  ),
  -- ---------------- aniversários ----------------
  aniv as (
    select x.id, x.nome_completo, x.nome_social, x.loja_atual_id, x.loja, x.data_nascimento,
           (select min(d) from (
              select make_date(extract(year from current_date)::int + a,
                               extract(month from x.data_nascimento)::int,
                               case when extract(month from x.data_nascimento) = 2 and extract(day from x.data_nascimento) = 29
                                     and not (((extract(year from current_date)::int + a) % 4 = 0
                                               and (extract(year from current_date)::int + a) % 100 <> 0)
                                              or (extract(year from current_date)::int + a) % 400 = 0)
                                    then 28 else extract(day from x.data_nascimento)::int end) as d
                from generate_series(0, 1) a) s
             where d >= current_date) as proximo
      from vis x where x.data_nascimento is not null
  )
  select jsonb_build_object(
    'experiencia', coalesce((
      select jsonb_agg(jsonb_build_object(
               'colaborador_id', e.id, 'nome', coalesce(e.nome_social, e.nome_completo), 'loja', e.loja,
               'admissao', e.data_admissao, 'fim_primeiro', e.fim_1, 'fim_prorrogacao', e.fim_2,
               'regra', e.exp_d1 || ' + ' || e.exp_d2,
               'fase', e.fase, 'termina_em', e.termina_em, 'dias', e.termina_em - current_date)
             order by e.termina_em)
        from exper_av e
       where e.termina_em <= current_date + 7), '[]'::jsonb),
    'ferias', coalesce((
      select jsonb_agg(jsonb_build_object(
               'colaborador_id', f.id, 'nome', coalesce(f.nome_social, f.nome_completo), 'loja', f.loja,
               'aquisitivo_inicio', f.aq_ini, 'aquisitivo_fim', f.aq_fim, 'concessivo_fim', f.concessivo_fim,
               'dias_gozados', f.dias_gozados, 'saldo', f.saldo, 'sair_ate', f.sair_ate,
               'dias', f.sair_ate - current_date)
             order by f.sair_ate)
        from ferias_av f), '[]'::jsonb),
    'aniversarios', coalesce((
      select jsonb_agg(jsonb_build_object(
               'colaborador_id', a.id, 'nome', coalesce(a.nome_social, a.nome_completo), 'loja', a.loja,
               'dia', a.proximo, 'dias', a.proximo - current_date)
             order by a.proximo)
        from aniv a
       where a.proximo <= current_date + 30), '[]'::jsonb),
    'gerado_em', now()
  );
$$;
revoke all on function public.painel_avisos(uuid) from public, anon;
grant execute on function public.painel_avisos(uuid) to authenticated;
comment on function public.painel_avisos(uuid) is
  'Avisos do painel: experiência terminando (7 dias) ou já vencida, pela regra do cargo, férias a vencer (90 dias) e aniversários (30 dias, só dia/mês). Filtra por colaborador.ler na loja.';
