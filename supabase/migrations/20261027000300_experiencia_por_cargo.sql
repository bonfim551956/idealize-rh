-- =====================================================================
-- IDEALIZE RH 360º — Regra de experiência por cargo
-- Padrão da empresa: 15 + 15 dias. Consultor (óptico/comercial): 15 + 30.
-- Os prazos ficam no cargo (experiencia_dias_1 / experiencia_dias_2).
-- O aviso do painel passa a usar a regra do cargo, avisa 7 dias antes e
-- mostra quem continua "em experiência" depois do prazo (contrato a atualizar).
-- =====================================================================
alter table public.cargos
  add column experiencia_dias_1 int not null default 15 check (experiencia_dias_1 between 1 and 90),
  add column experiencia_dias_2 int not null default 15 check (experiencia_dias_2 between 0 and 90),
  add constraint cargos_experiencia_max check (experiencia_dias_1 + experiencia_dias_2 <= 90);

update public.cargos set experiencia_dias_2 = 30 where nome ilike 'CONSULTOR%';

-- cargo novo de consultor já nasce com 15 + 30
create or replace function privado.cargo_experiencia_padrao()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.nome ilike 'CONSULTOR%' and new.experiencia_dias_1 = 15 and new.experiencia_dias_2 = 15 then
    new.experiencia_dias_2 := 30;
  end if;
  return new;
end $$;
create trigger cargos_experiencia_padrao before insert on public.cargos
  for each row execute function privado.cargo_experiencia_padrao();

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
    select t.colaborador_id,
           to_date(substring(t.descricao from '(?i)aquisitivo (\d{2}/\d{2}/\d{4})'), 'DD/MM/YYYY') as aq_ini,
           to_date(substring(t.titulo from '(?i)de (\d{2}/\d{2}/\d{4}) a'), 'DD/MM/YYYY') as g_ini,
           to_date(substring(t.titulo from '(?i) a (\d{2}/\d{2}/\d{4})'), 'DD/MM/YYYY') as g_fim
      from public.eventos_timeline t
     where t.tipo = 'ferias'
       and t.colaborador_id in (select id from vis)
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
