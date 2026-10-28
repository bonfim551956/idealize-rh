-- =====================================================================
-- IDEALIZE RH 360º — Férias: programação por período aquisitivo
-- * abono pecuniário (dias vendidos) nas férias lançadas
-- * "período já quitado" (férias tiradas antes do sistema, sem datas)
-- * public.ferias_programacao: períodos em aberto, no formato do relatório
--   da contabilidade (direito, gozados, saldo, limite p/ gozo, programação)
-- * public.ferias_lancar: lança férias com datas ou quita um período
-- * painel_avisos passa a usar o mesmo cálculo
-- =====================================================================

alter table public.ausencias add column abono_dias int not null default 0
  check (abono_dias between 0 and 10);
alter table public.ausencias add constraint ausencias_abono_so_ferias check (abono_dias = 0 or tipo = 'ferias');

create table public.ferias_quitacoes (
  id                uuid primary key default gen_random_uuid(),
  colaborador_id    uuid not null references public.colaboradores(id) on delete restrict,
  aquisitivo_inicio date not null,
  observacao        text check (observacao is null or length(observacao) <= 500),
  cancelada         boolean not null default false,
  cancelada_motivo  text,
  registrado_por    uuid references public.usuarios(id) default auth.uid(),
  registrado_em     timestamptz not null default now()
);
create unique index ferias_quitacoes_unica on public.ferias_quitacoes (colaborador_id, aquisitivo_inicio) where not cancelada;
create trigger a_maiusculas before insert or update on public.ferias_quitacoes
  for each row execute function privado.maiusculas('observacao', 'cancelada_motivo');
create trigger auditar after insert or update or delete on public.ferias_quitacoes
  for each row execute function privado.auditar();
create or replace function privado.travar_quitacao()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Quitações de férias não são apagadas; cancele com motivo'; end if;
  if coalesce(current_setting('idealize.via_funcao', true), '') <> 'ferias' then
    raise exception 'Quitações de férias só mudam pelas funções próprias' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger travar before update or delete on public.ferias_quitacoes
  for each row execute function privado.travar_quitacao();
alter table public.ferias_quitacoes enable row level security;
create policy ferias_quitacoes_ler on public.ferias_quitacoes for select to authenticated
  using (privado.pode('ausencia.ler', privado.loja_do_colaborador(colaborador_id)));
revoke insert, update, delete, truncate on public.ferias_quitacoes from anon, authenticated;
revoke all on public.ferias_quitacoes from anon;

-- ---------------------------------------------------------------------
-- Cálculo (sem checagem de permissão; quem chama filtra)
-- ---------------------------------------------------------------------
create or replace function privado.ferias_periodos(p_colaboradores uuid[])
returns table (colaborador_id uuid, admissao date, aq_ini date, aq_fim date, completo boolean,
               dias_direito numeric, dias_gozados int, abono int, saldo numeric, saldo_livre numeric,
               concessivo_fim date, limite date, quitado boolean,
               programado_inicio date, programado_dias int, programado_abono int, situacao text)
language sql stable security definer set search_path = '' as $$
  with vin as (
    select distinct on (v.colaborador_id) v.colaborador_id, v.data_admissao
      from public.vinculos v
     where v.colaborador_id = any (p_colaboradores) and v.tipo::text like 'clt%' and v.data_admissao is not null
       and v.status in ('ativo', 'em_ferias', 'afastado', 'em_licenca')
     order by v.colaborador_id, v.data_admissao desc
  ),
  per as (
    select x.colaborador_id, x.data_admissao,
           (x.data_admissao + make_interval(years => k - 1))::date as aq_ini,
           (x.data_admissao + make_interval(years => k) - interval '1 day')::date as aq_fim
      from vin x cross join generate_series(1, 60) k
     where (x.data_admissao + make_interval(years => k - 1))::date <= current_date
  ),
  lanc as (   -- férias lançadas como ausência (com abono)
    select a.colaborador_id, a.aquisitivo_inicio as aq_ini, a.data_inicio, (a.data_fim - a.data_inicio + 1) as dias, a.abono_dias
      from public.ausencias a
     where a.tipo = 'ferias' and not a.cancelada and a.colaborador_id = any (p_colaboradores)
  ),
  hist as (   -- férias antigas registradas pela linha do tempo
    select t.colaborador_id,
           to_date(substring(t.descricao from '(?i)aquisitivo (\d{2}/\d{2}/\d{4})'), 'DD/MM/YYYY') as aq_ini,
           to_date(substring(t.titulo from '(?i)de (\d{2}/\d{2}/\d{4}) a'), 'DD/MM/YYYY') as g_ini,
           to_date(substring(t.titulo from '(?i) a (\d{2}/\d{2}/\d{4})'), 'DD/MM/YYYY') as g_fim
      from public.eventos_timeline t
     where t.tipo = 'ferias' and t.colaborador_id = any (p_colaboradores)
  ),
  calc as (
    select p.*,
           p.aq_fim < current_date as completo,
           (p.aq_fim + interval '1 year')::date as concessivo_fim,
           case when p.aq_fim < current_date then 30::numeric
                else least(30, 2.5 * ((extract(year from age(current_date + 1, p.aq_ini)) * 12 + extract(month from age(current_date + 1, p.aq_ini)))
                                      + case when extract(day from age(current_date + 1, p.aq_ini)) >= 15 then 1 else 0 end)) end as dias_direito,
           exists (select 1 from public.ferias_quitacoes q where q.colaborador_id = p.colaborador_id
                     and q.aquisitivo_inicio = p.aq_ini and not q.cancelada) as quitado,
           coalesce((select sum(l.dias) from lanc l where l.colaborador_id = p.colaborador_id and l.aq_ini = p.aq_ini and l.data_inicio <= current_date), 0)
             + coalesce((select sum(greatest(0, h.g_fim - h.g_ini + 1)) from hist h where h.colaborador_id = p.colaborador_id and h.aq_ini = p.aq_ini
                          and h.g_ini is not null and h.g_fim is not null), 0) as gozo_feito,
           coalesce((select sum(l.abono_dias) from lanc l where l.colaborador_id = p.colaborador_id and l.aq_ini = p.aq_ini and l.data_inicio <= current_date), 0) as abono_feito,
           coalesce((select sum(l.dias + l.abono_dias) from lanc l where l.colaborador_id = p.colaborador_id and l.aq_ini = p.aq_ini and l.data_inicio > current_date), 0) as programado_total,
           (select l.data_inicio from lanc l where l.colaborador_id = p.colaborador_id and l.aq_ini = p.aq_ini and l.data_inicio > current_date order by l.data_inicio limit 1) as prog_ini
      from per p
  ),
  fim as (
    select c.*,
           (select l.dias from lanc l where l.colaborador_id = c.colaborador_id and l.aq_ini = c.aq_ini and l.data_inicio = c.prog_ini limit 1) as prog_dias,
           (select l.abono_dias from lanc l where l.colaborador_id = c.colaborador_id and l.aq_ini = c.aq_ini and l.data_inicio = c.prog_ini limit 1) as prog_abono,
           greatest(0, c.dias_direito - c.gozo_feito - c.abono_feito) as saldo_calc,
           greatest(0, (case when c.completo then 30 else c.dias_direito end) - c.gozo_feito - c.abono_feito - c.programado_total) as livre
      from calc c
  )
  select f.colaborador_id, f.data_admissao, f.aq_ini, f.aq_fim, f.completo, f.dias_direito,
         f.gozo_feito::int, f.abono_feito::int, f.saldo_calc, f.livre, f.concessivo_fim,
         (f.concessivo_fim - (case when f.completo then greatest(f.livre, 1) else 30 end)::int + 1) as limite,
         f.quitado, f.prog_ini, f.prog_dias, f.prog_abono,
         case when not f.completo then 'em_aquisicao'
              when f.livre <= 0 then 'programada'
              when (f.concessivo_fim - greatest(f.livre, 1)::int + 1) < current_date then 'vencida'
              when (f.concessivo_fim - greatest(f.livre, 1)::int + 1) <= current_date + 90 then 'urgente'
              else 'a_programar' end
    from fim f
   where not f.quitado
     and (not f.completo or f.livre > 0 or f.prog_ini is not null)
$$;
revoke all on function privado.ferias_periodos(uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Tela Férias
-- ---------------------------------------------------------------------
create or replace function public.ferias_programacao(p_loja uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  with vis as (
    select c.id, coalesce(c.nome_social, c.nome_completo) as nome, c.loja_atual_id, l.nome as loja
      from public.colaboradores c join public.lojas l on l.id = c.loja_atual_id
     where (p_loja is null or c.loja_atual_id = p_loja) and privado.pode('colaborador.ler', c.loja_atual_id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'colaborador_id', f.colaborador_id, 'nome', v.nome, 'loja_id', v.loja_atual_id, 'loja', v.loja,
           'admissao', f.admissao, 'aquisitivo_inicio', f.aq_ini, 'aquisitivo_fim', f.aq_fim, 'completo', f.completo,
           'dias_direito', f.dias_direito, 'dias_gozados', f.dias_gozados, 'abono', f.abono, 'saldo', f.saldo, 'saldo_livre', f.saldo_livre,
           'limite', f.limite, 'concessivo_fim', f.concessivo_fim, 'dias_ate_limite', f.limite - current_date,
           'programado_inicio', f.programado_inicio, 'programado_dias', f.programado_dias, 'programado_abono', f.programado_abono,
           'situacao', f.situacao) order by f.limite, v.nome), '[]'::jsonb)
    from privado.ferias_periodos(array(select id from vis)) f join vis v on v.id = f.colaborador_id
$$;
revoke all on function public.ferias_programacao(uuid) from public, anon;
grant execute on function public.ferias_programacao(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Lançar férias (com datas) ou quitar período (sem datas)
-- ---------------------------------------------------------------------
create or replace function public.ferias_lancar(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_colab uuid := (privado.texto(p, 'colaborador_id'))::uuid;
  v_loja  uuid := privado.loja_do_colaborador(v_colab);
  v_aq    date := (privado.texto(p, 'aquisitivo_inicio'))::date;
  v_modo  text := privado.texto(p, 'modo');
  v_ini   date := (privado.texto(p, 'data_inicio'))::date;
  v_dias  int  := (privado.texto(p, 'dias'))::int;
  v_abono int  := coalesce((privado.texto(p, 'abono'))::int, 0);
  v_obs   text := nullif(trim(privado.texto(p, 'observacao')), '');
  f record; v_id uuid; v_fim date;
begin
  if v_loja is null then raise exception 'Colaborador não encontrado'; end if;
  perform privado.exigir('ausencia.registrar', v_loja);
  select * into f from privado.ferias_periodos(array[v_colab]) x where x.aq_ini = v_aq;
  if f.aq_ini is null then raise exception 'Período aquisitivo não encontrado ou já quitado'; end if;

  if v_modo = 'quitado' then
    if not f.completo then raise exception 'Só é possível quitar um período aquisitivo já completo'; end if;
    insert into public.ferias_quitacoes (colaborador_id, aquisitivo_inicio, observacao)
    values (v_colab, v_aq, v_obs) returning id into v_id;
    perform privado.timeline(v_colab, null, 'ferias', current_date,
      'PERÍODO DE FÉRIAS QUITADO (' || to_char(f.aq_ini, 'DD/MM/YYYY') || ' A ' || to_char(f.aq_fim, 'DD/MM/YYYY') || ')',
      coalesce(upper(v_obs), 'FÉRIAS JÁ TIRADAS ANTES DO SISTEMA'), 'contratual');
    return v_id;
  elsif v_modo <> 'datas' then
    raise exception 'Informe o que lançar';
  end if;

  if v_ini is null or v_dias is null then raise exception 'Informe o início e os dias de descanso'; end if;
  if v_dias < 5 or v_dias > 30 then raise exception 'Cada parte das férias tem de 5 a 30 dias'; end if;
  if v_abono < 0 or v_abono > 10 then raise exception 'Abono de 0 a 10 dias'; end if;
  if v_abono > floor((case when f.completo then 30 else f.dias_direito end) / 3) then raise exception 'Abono de no máximo 1/3 do direito'; end if;
  if v_dias + v_abono > f.saldo_livre then
    raise exception 'Gozo + abono (% dias) passam do saldo disponível (% dias)', v_dias + v_abono, f.saldo_livre;
  end if;
  if v_ini < f.aq_ini then raise exception 'O início é anterior ao período aquisitivo'; end if;
  v_fim := v_ini + v_dias - 1;
  if exists (select 1 from public.ausencias a where a.colaborador_id = v_colab and not a.cancelada and a.tipo = 'ferias'
              and a.data_inicio <= v_fim and a.data_fim >= v_ini) then
    raise exception 'Já existem férias lançadas nesse intervalo para este colaborador';
  end if;

  insert into public.ausencias (colaborador_id, tipo, data_inicio, data_fim, aquisitivo_inicio, abono_dias, observacao)
  values (v_colab, 'ferias', v_ini, v_fim, v_aq, v_abono, v_obs) returning id into v_id;
  perform privado.timeline(v_colab, null, 'ausencia', v_ini,
    'FÉRIAS DE ' || to_char(v_ini, 'DD/MM/YYYY') || ' A ' || to_char(v_fim, 'DD/MM/YYYY'),
    'PERÍODO AQUISITIVO ' || to_char(v_aq, 'DD/MM/YYYY') || case when v_abono > 0 then ' · ABONO DE ' || v_abono || ' DIAS' else '' end
      || coalesce(' · ' || upper(v_obs), ''), 'contratual');
  return v_id;
end $$;
revoke all on function public.ferias_lancar(jsonb) from public, anon;
grant execute on function public.ferias_lancar(jsonb) to authenticated;

-- desfazer uma quitação lançada por engano
create or replace function public.ferias_quitacao_cancelar(p_colaborador uuid, p_aquisitivo date, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform privado.exigir('ausencia.registrar', privado.loja_do_colaborador(p_colaborador));
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo do cancelamento'; end if;
  perform set_config('idealize.via_funcao', 'ferias', true);
  update public.ferias_quitacoes set cancelada = true, cancelada_motivo = trim(p_motivo)
   where colaborador_id = p_colaborador and aquisitivo_inicio = p_aquisitivo and not cancelada;
  if not found then raise exception 'Quitação não encontrada'; end if;
  perform set_config('idealize.via_funcao', '', true);
  perform privado.timeline(p_colaborador, null, 'ferias', current_date,
    'QUITAÇÃO DE FÉRIAS CANCELADA (' || to_char(p_aquisitivo, 'DD/MM/YYYY') || ')', upper(trim(p_motivo)), 'contratual');
end $$;
revoke all on function public.ferias_quitacao_cancelar(uuid, date, text) from public, anon;
grant execute on function public.ferias_quitacao_cancelar(uuid, date, text) to authenticated;

-- painel: aviso de férias usa o mesmo cálculo da tela Férias (vencidas ou limite em até 90 dias)
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
  ferias_av as (
    select x.id, x.nome_completo, x.nome_social, x.loja_atual_id, x.loja,
           p.aq_ini, p.aq_fim, p.concessivo_fim, (30 - p.saldo_livre)::int as dias_gozados,
           p.saldo_livre as saldo, p.limite as sair_ate
      from privado.ferias_periodos(array(select id from vis)) p join vis x on x.id = p.colaborador_id
     where p.situacao in ('vencida', 'urgente')
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

-- pendências: férias levam para a tela Férias
create or replace function public.painel_pendencias(p_loja uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  r jsonb := '[]'::jsonb;
  av jsonb := public.painel_avisos(p_loja);
  n int; itens jsonb; grave boolean;
  prox date := (date_trunc('month', current_date) + interval '1 month')::date;
begin
  -- 1) Documentos aguardando conferência
  select count(*), coalesce(jsonb_agg(x) filter (where rn <= 6), '[]') into n, itens from (
    select jsonb_build_object('nome', coalesce(c.nome_completo, d.nome), 'detalhe', d.nome || ' · enviado ' || to_char(d.criado_em at time zone 'America/Sao_Paulo', 'DD/MM'),
                              'link', '/documentos') x,
           row_number() over (order by d.criado_em) rn
      from public.documentos d left join public.colaboradores c on c.id = d.colaborador_id
     where d.status in ('recebido', 'em_conferencia') and (p_loja is null or d.loja_id = p_loja)
       and privado.pode('documento.conferir', d.loja_id) and privado.pode_documento('ler', d.categoria_id, d.loja_id)) s;
  if n > 0 then r := r || jsonb_build_object('chave', 'docs_conferir', 'titulo', 'Documentos aguardando conferência', 'gravidade', 'media',
    'quantidade', n, 'link', '/documentos', 'acao', 'Conferir', 'itens', itens); end if;

  -- 2) Documentos vencidos
  select count(*), coalesce(jsonb_agg(x) filter (where rn <= 6), '[]') into n, itens from (
    select jsonb_build_object('nome', coalesce(c.nome_completo, d.nome), 'detalhe', d.nome || ' · venceu ' || to_char(d.vencimento, 'DD/MM/YYYY'), 'link', '/documentos') x,
           row_number() over (order by d.vencimento) rn
      from public.documentos d left join public.colaboradores c on c.id = d.colaborador_id
     where d.vencimento < current_date and d.status not in ('arquivado', 'reprovado')
       and not exists (select 1 from public.documentos n2 where n2.colaborador_id is not distinct from d.colaborador_id
                        and n2.categoria_id = d.categoria_id and n2.loja_id = d.loja_id and n2.id <> d.id
                        and n2.status not in ('reprovado', 'arquivado') and n2.vencimento > d.vencimento) and (p_loja is null or d.loja_id = p_loja)
       and privado.pode_documento('ler', d.categoria_id, d.loja_id)) s;
  if n > 0 then r := r || jsonb_build_object('chave', 'docs_vencidos', 'titulo', 'Documentos vencidos (ex.: ASO)', 'gravidade', 'alta',
    'quantidade', n, 'link', '/documentos', 'acao', 'Renovar', 'itens', itens); end if;

  -- 3) Documentos vencendo em 30 dias
  select count(*), coalesce(jsonb_agg(x) filter (where rn <= 6), '[]') into n, itens from (
    select jsonb_build_object('nome', coalesce(c.nome_completo, d.nome), 'detalhe', d.nome || ' · vence ' || to_char(d.vencimento, 'DD/MM/YYYY'), 'link', '/documentos') x,
           row_number() over (order by d.vencimento) rn
      from public.documentos d left join public.colaboradores c on c.id = d.colaborador_id
     where d.vencimento between current_date and current_date + 30 and d.status not in ('arquivado', 'vencido', 'reprovado')
       and not exists (select 1 from public.documentos n2 where n2.colaborador_id is not distinct from d.colaborador_id
                        and n2.categoria_id = d.categoria_id and n2.loja_id = d.loja_id and n2.id <> d.id
                        and n2.status not in ('reprovado', 'arquivado') and n2.vencimento > d.vencimento)
       and (p_loja is null or d.loja_id = p_loja) and privado.pode_documento('ler', d.categoria_id, d.loja_id)) s;
  if n > 0 then r := r || jsonb_build_object('chave', 'docs_vencendo', 'titulo', 'Documentos vencendo em 30 dias', 'gravidade', 'media',
    'quantidade', n, 'link', '/documentos', 'acao', 'Programar', 'itens', itens); end if;

  -- 4) Contratos de experiência (encerrados sem atualização ou terminando em 7 dias)
  select count(*), coalesce(jsonb_agg(jsonb_build_object('nome', e->>'nome',
           'detalhe', case when e->>'fase' = 'vencido' then 'experiência encerrada em ' || to_char((e->>'termina_em')::date, 'DD/MM') || ' · efetivar ou encerrar'
                           else case when e->>'fase' = 'primeiro' then '1º período' else 'prorrogação' end || ' termina ' || to_char((e->>'termina_em')::date, 'DD/MM') end,
           'link', '/colaboradores/' || (e->>'colaborador_id'))) filter (where rn <= 6), '[]'),
         coalesce(bool_or(e->>'fase' = 'vencido'), false)
    into n, itens, grave from (select e, row_number() over () rn from jsonb_array_elements(av->'experiencia') e) s;
  if n > 0 then r := r || jsonb_build_object('chave', 'experiencia', 'titulo', 'Contratos de experiência', 'gravidade',
    case when grave then 'alta' else 'media' end, 'quantidade', n, 'link', '/', 'acao', 'Decidir', 'itens', itens); end if;

  -- 5) Férias a vencer / vencidas
  select count(*), coalesce(jsonb_agg(jsonb_build_object('nome', f->>'nome',
           'detalhe', 'saldo ' || (f->>'saldo') || ' dias · sair até ' || to_char((f->>'sair_ate')::date, 'DD/MM/YYYY'),
           'link', '/colaboradores/' || (f->>'colaborador_id'))) filter (where rn <= 6), '[]')
    into n, itens from (select f, row_number() over () rn from jsonb_array_elements(av->'ferias') f) s;
  if n > 0 then r := r || jsonb_build_object('chave', 'ferias', 'titulo', 'Férias vencidas ou com limite em até 90 dias', 'gravidade',
    case when exists (select 1 from jsonb_array_elements(av->'ferias') f where (f->>'dias')::int < 0) then 'alta' else 'media' end,
    'quantidade', n, 'link', '/ferias', 'acao', 'Programar férias', 'itens', itens); end if;

  -- 6) Desligamentos em andamento
  select count(*), coalesce(jsonb_agg(x) filter (where rn <= 6), '[]') into n, itens from (
    select jsonb_build_object('nome', c.nome_completo, 'detalhe', replace(dl.modalidade, '_', ' ') || ' · comunicado ' || to_char(dl.data_comunicacao, 'DD/MM'),
                              'link', '/colaboradores/' || c.id) x, row_number() over (order by dl.data_comunicacao) rn
      from public.desligamentos dl join public.vinculos v on v.id = dl.vinculo_id join public.colaboradores c on c.id = v.colaborador_id
     where dl.status = 'em_andamento' and (p_loja is null or c.loja_atual_id = p_loja) and privado.pode('desligamento.gerir', c.loja_atual_id)) s;
  if n > 0 then r := r || jsonb_build_object('chave', 'desligamentos', 'titulo', 'Desligamentos em andamento', 'gravidade', 'media',
    'quantidade', n, 'link', '/colaboradores', 'acao', 'Concluir', 'itens', itens); end if;

  -- 7) Admissões em aberto (pré-admissão / em admissão)
  select count(*), coalesce(jsonb_agg(x) filter (where rn <= 6), '[]') into n, itens from (
    select jsonb_build_object('nome', c.nome_completo, 'detalhe', 'admissão prevista ' || coalesce(to_char(v.data_admissao, 'DD/MM/YYYY'), 'sem data'),
                              'link', '/colaboradores/' || c.id) x, row_number() over (order by v.data_admissao) rn
      from public.vinculos v join public.colaboradores c on c.id = v.colaborador_id
     where v.status in ('pre_admissao', 'em_admissao') and (p_loja is null or c.loja_atual_id = p_loja) and privado.pode('colaborador.ler', c.loja_atual_id)) s;
  if n > 0 then r := r || jsonb_build_object('chave', 'admissoes', 'titulo', 'Admissões em aberto', 'gravidade', 'baixa',
    'quantidade', n, 'link', '/colaboradores', 'acao', 'Concluir admissão', 'itens', itens); end if;

  -- 8) Equipamentos sem termo assinado
  select count(*), coalesce(jsonb_agg(x) filter (where rn <= 6), '[]') into n, itens from (
    select jsonb_build_object('nome', c.nome_completo, 'detalhe', e.tipo || coalesce(' ' || e.descricao, '') || ' · entregue ' || to_char(e.data_entrega, 'DD/MM'),
                              'link', '/colaboradores/' || c.id) x, row_number() over (order by e.data_entrega) rn
      from public.equipamentos e join public.colaboradores c on c.id = e.colaborador_id
     where e.documento_id is null and not e.cancelado and e.devolvido_em is null
       and (p_loja is null or c.loja_atual_id = p_loja) and privado.pode('equipamento.ler', c.loja_atual_id)) s;
  if n > 0 then r := r || jsonb_build_object('chave', 'equip_sem_termo', 'titulo', 'Equipamentos sem termo assinado', 'gravidade', 'media',
    'quantidade', n, 'link', '/colaboradores', 'acao', 'Anexar termo', 'itens', itens); end if;

  -- 9) Desligados com equipamento ou uniforme em mãos
  select count(*), coalesce(jsonb_agg(x) filter (where rn <= 6), '[]') into n, itens from (
    select jsonb_build_object('nome', c.nome_completo, 'detalhe',
             concat_ws(' · ', case when q.eq > 0 then q.eq || ' equipamento(s)' end, case when q.un > 0 then q.un || ' peça(s) de uniforme' end),
             'link', '/colaboradores/' || c.id) x, row_number() over (order by c.nome_completo) rn
      from public.colaboradores c
      cross join lateral (select
         case when privado.pode('equipamento.ler', c.loja_atual_id) then
           (select count(*) from public.equipamentos e where e.colaborador_id = c.id and not e.cancelado and e.devolvido_em is null) else 0 end as eq,
         case when privado.pode('uniforme.ler', c.loja_atual_id) then
           (select coalesce(sum(m.posse_delta), 0) from public.uniforme_movimentos m where m.colaborador_id = c.id) else 0 end as un) q
     where exists (select 1 from public.vinculos v where v.colaborador_id = c.id and v.status in ('desligado', 'em_desligamento'))
       and not exists (select 1 from public.vinculos v where v.colaborador_id = c.id
                        and v.status in ('ativo', 'em_ferias', 'afastado', 'em_licenca', 'pre_admissao', 'em_admissao'))
       and (q.eq > 0 or q.un > 0) and (p_loja is null or c.loja_atual_id = p_loja)) s;
  if n > 0 then r := r || jsonb_build_object('chave', 'devolucoes', 'titulo', 'Devoluções pendentes (desligamento)', 'gravidade', 'alta',
    'quantidade', n, 'link', '/colaboradores', 'acao', 'Registrar devolução', 'itens', itens); end if;

  -- 10) VT: ativos sem cadastro de VT
  select count(*), coalesce(jsonb_agg(x) filter (where rn <= 6), '[]') into n, itens from (
    select jsonb_build_object('nome', c.nome_completo, 'detalhe', 'informar se recebe e o valor diário', 'link', '/vale-transporte') x,
           row_number() over (order by c.nome_completo) rn
      from public.colaboradores c
     where exists (select 1 from public.vinculos v where v.colaborador_id = c.id
                    and v.status in ('ativo', 'em_ferias', 'afastado', 'em_licenca', 'pre_admissao', 'em_admissao'))
       and not exists (select 1 from public.vt_cadastros t where t.colaborador_id = c.id)
       and (p_loja is null or c.loja_atual_id = p_loja) and privado.pode('vt.ler', c.loja_atual_id)) s;
  if n > 0 then r := r || jsonb_build_object('chave', 'vt_cadastro', 'titulo', 'Sem cadastro de vale-transporte', 'gravidade', 'media',
    'quantidade', n, 'link', '/vale-transporte', 'acao', 'Cadastrar VT', 'itens', itens); end if;

  -- 11) VT do próximo mês ainda não fechado (a partir do dia 20)
  if extract(day from current_date) >= 20 and privado.pode_em_alguma('vt.gerir')
     and not exists (select 1 from public.vt_fechamentos f where f.mes = prox and (p_loja is null or f.loja_id = p_loja)) then
    r := r || jsonb_build_object('chave', 'vt_fechar', 'titulo', 'Fechar o VT de ' || to_char(prox, 'MM/YYYY'), 'gravidade', 'media',
      'quantidade', 1, 'link', '/vale-transporte', 'acao', 'Conferir e fechar', 'itens', '[]'::jsonb);
  end if;

  -- 12) Uniformes abaixo do estoque mínimo
  if privado.pode_em_alguma('uniforme.ler') then
    select count(*), coalesce(jsonb_agg(x) filter (where rn <= 6), '[]') into n, itens from (
      select jsonb_build_object('nome', i.peca || ' · ' || i.tamanho, 'detalhe', 'estoque ' || privado.saldo_uniforme(i.id) || ' de ' || i.estoque_minimo,
                                'link', '/uniformes') x, row_number() over (order by i.peca, i.tamanho) rn
        from public.uniforme_itens i where i.ativo and privado.saldo_uniforme(i.id) < i.estoque_minimo) s;
    if n > 0 then r := r || jsonb_build_object('chave', 'uniformes', 'titulo', 'Uniformes abaixo do mínimo', 'gravidade', 'baixa',
      'quantidade', n, 'link', '/uniformes', 'acao', 'Ver pedido de compra', 'itens', itens); end if;
  end if;

  -- 13) Convites de acesso não ativados
  if privado.pode('acesso.gerir') then
    select count(*), coalesce(jsonb_agg(jsonb_build_object('nome', u.nome, 'detalhe', u.email || ' · convidado ' || to_char(coalesce(a.invited_at, a.created_at) at time zone 'America/Sao_Paulo', 'DD/MM'),
             'link', '/acessos')), '[]') into n, itens
      from auth.users a join public.usuarios u on u.id = a.id
     where a.email_confirmed_at is null and a.last_sign_in_at is null and u.ativo;
    if n > 0 then r := r || jsonb_build_object('chave', 'convites', 'titulo', 'Convites de acesso não ativados', 'gravidade', 'baixa',
      'quantidade', n, 'link', '/acessos', 'acao', 'Reenviar convite', 'itens', itens); end if;
  end if;

  -- 14) Tarefas abertas
  select count(*), coalesce(jsonb_agg(x) filter (where rn <= 6), '[]') into n, itens from (
    select jsonb_build_object('nome', t.titulo, 'detalhe', coalesce('prazo ' || to_char(t.prazo, 'DD/MM'), 'sem prazo'), 'link', '/') x,
           row_number() over (order by t.prazo nulls last) rn
      from public.tarefas t
     where t.status in ('aberta', 'em_andamento') and (p_loja is null or t.loja_id = p_loja)
       and (t.responsavel_id = auth.uid() or (t.loja_id is not null and privado.pode('tarefa.ler', t.loja_id))
            or (t.loja_id is null and privado.pode('tarefa.ler')))) s;
  if n > 0 then r := r || jsonb_build_object('chave', 'tarefas', 'titulo', 'Tarefas abertas', 'gravidade', 'baixa',
    'quantidade', n, 'link', '/', 'acao', 'Ver', 'itens', itens); end if;

  return jsonb_build_object('pendencias', r, 'gerado_em', now());
end $$;
revoke all on function public.painel_pendencias(uuid) from public, anon;
grant execute on function public.painel_pendencias(uuid) to authenticated;
