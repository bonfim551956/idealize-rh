-- =====================================================================
-- IDEALIZE RH 360º — VT: ajuste manual por colaborador no mês
-- Troca os dias a pagar de uma pessoa num mês (ex.: férias já pagas
-- proporcionais), com motivo obrigatório e auditoria. As ausências seguem
-- contando como tratadas (o fechamento guarda os dias excluídos calculados),
-- então o mês seguinte não desconta de novo.
-- =====================================================================
create table public.vt_ajustes (
  id             uuid primary key default gen_random_uuid(),
  mes            date not null check (extract(day from mes) = 1),
  colaborador_id uuid not null references public.colaboradores(id) on delete restrict,
  dias_pagar     int not null check (dias_pagar between 0 and 31),
  motivo         text not null check (length(trim(motivo)) between 3 and 300),
  registrado_por uuid references public.usuarios(id) default auth.uid(),
  registrado_em  timestamptz not null default now(),
  unique (mes, colaborador_id)
);
create trigger a_maiusculas before insert or update on public.vt_ajustes
  for each row execute function privado.maiusculas('motivo');
create trigger auditar after insert or update or delete on public.vt_ajustes
  for each row execute function privado.auditar();
alter table public.vt_ajustes enable row level security;
create policy vt_ajustes_ler on public.vt_ajustes for select to authenticated
  using (privado.pode('vt.ler', privado.loja_do_colaborador(colaborador_id)));
revoke insert, update, delete, truncate on public.vt_ajustes from anon, authenticated;
revoke all on public.vt_ajustes from anon;

create or replace function public.vt_ajustar(p_mes date, p_colaborador uuid, p_dias int, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_mes date := date_trunc('month', p_mes)::date; v_loja uuid := privado.loja_do_colaborador(p_colaborador); v_base int;
begin
  if v_loja is null then raise exception 'Colaborador não encontrado'; end if;
  perform privado.exigir('vt.gerir', v_loja);
  if exists (select 1 from public.vt_fechamentos f where f.mes = v_mes and f.colaborador_id = p_colaborador) then
    raise exception 'Este mês já foi fechado para este colaborador. Refaça o fechamento depois de ajustar.';
  end if;
  if p_dias is null then
    delete from public.vt_ajustes where mes = v_mes and colaborador_id = p_colaborador;
    return;
  end if;
  select c.dias_base into v_base from public.vt_calculo(v_mes, v_loja) c where c.colaborador_id = p_colaborador;
  if v_base is null then raise exception 'Colaborador fora do cálculo deste mês'; end if;
  if p_dias < 0 or p_dias > v_base then raise exception 'Dias a pagar de 0 a %', v_base; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo do ajuste'; end if;
  insert into public.vt_ajustes (mes, colaborador_id, dias_pagar, motivo)
  values (v_mes, p_colaborador, p_dias, trim(p_motivo))
  on conflict (mes, colaborador_id) do update
    set dias_pagar = excluded.dias_pagar, motivo = excluded.motivo, registrado_por = auth.uid(), registrado_em = now();
end $$;
revoke all on function public.vt_ajustar(date, uuid, int, text) from public, anon;
grant execute on function public.vt_ajustar(date, uuid, int, text) to authenticated;

drop function public.vt_calculo(date, uuid);
create or replace function public.vt_calculo(p_mes date, p_loja uuid default null)
returns table (
  colaborador_id uuid, nome text, loja_id uuid, loja text, cargo text,
  situacao text,                 -- 'recebe' | 'nao_recebe' | 'sem_cadastro'
  valor_diario numeric, periodo_inicio date, periodo_fim date,
  dias_base int, dias_excluidos int, ausencias_mes_anterior int, ja_descontado int,
  dias_desconto_anterior int, dias_pagar int, valor numeric,
  fechado boolean, fechado_dias int, fechado_valor numeric, observacao text,
  dias_calculado int, ajuste_dias int, ajuste_motivo text)
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
         case when aj.dias_pagar is null then k.d_calc else least(aj.dias_pagar, k.d_base) end,
         case when k.recebe then round(case when aj.dias_pagar is null then k.d_calc else least(aj.dias_pagar, k.d_base) end * k.valor_diario, 2) else 0 end,
         f.id is not null, f.dias_pagos, f.valor, k.observacao,
         k.d_calc, aj.dias_pagar, aj.motivo
    from (select c.*, greatest(0, c.d_base - c.d_excl - greatest(0, c.d_aus_ant - c.d_ja)) as d_calc from conta c) k
    left join public.vt_fechamentos f on f.mes = k.m_ini and f.colaborador_id = k.id
    left join public.vt_ajustes aj on aj.mes = k.m_ini and aj.colaborador_id = k.id
   order by k.loja, k.nome;
$$;
revoke all on function public.vt_calculo(date, uuid) from public, anon;
grant execute on function public.vt_calculo(date, uuid) to authenticated;

-- fechamento leva o motivo do ajuste na observação
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
         c.dias_desconto_anterior, c.dias_pagar, c.valor,
         left(concat_ws(' · ', c.observacao, case when c.ajuste_dias is not null
           then 'AJUSTE MANUAL (' || c.dias_calculado || ' → ' || c.ajuste_dias || ' DIAS): ' || c.ajuste_motivo end), 500)
    from public.vt_calculo(v_mes, p_loja) c
   where c.situacao = 'recebe';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.vt_fechar(date, uuid, boolean) from public, anon;
grant execute on function public.vt_fechar(date, uuid, boolean) to authenticated;
