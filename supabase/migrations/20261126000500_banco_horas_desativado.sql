-- Banco de horas desativado: some do menu e do painel; o robô do VR para de rodar.
-- Os dados ficam guardados. Para reativar: update privado.modulos set ativo = true where codigo = 'banco_horas'
-- (e voltar o agendamento do robô em .github/workflows/banco-horas.yml).

create table if not exists privado.modulos (codigo text primary key, ativo boolean not null default true, alterado_em timestamptz not null default now());
insert into privado.modulos (codigo, ativo) values ('banco_horas', false)
  on conflict (codigo) do update set ativo = false, alterado_em = now();

create or replace function privado.modulo_ativo(p_codigo text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select m.ativo from privado.modulos m where m.codigo = p_codigo), true);
$$;

-- o front pergunta quais módulos estão ligados
create or replace function public.modulos_ativos()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(codigo, ativo), '{}'::jsonb) from privado.modulos;
$$;
revoke all on function public.modulos_ativos() from public, anon;
grant execute on function public.modulos_ativos() to authenticated;

do $$
declare d text := pg_get_functiondef('public.painel_pendencias(uuid)'::regprocedure); n int;
  t text[] := array[
    'if exists (select 1 from public.banco_horas_execucoes) and privado.pode_em_alguma(''colaborador.editar'')',
    'if privado.modulo_ativo(''banco_horas'') and exists (select 1 from public.banco_horas_execucoes) and privado.pode_em_alguma(''colaborador.editar'')',
    'p.tipo in (''registro_faltando'', ''falta'') and privado.bh_pend_aberta(p.tipo, p.status) and privado.colaborador_vigente(c.id)',
    'p.tipo in (''registro_faltando'', ''falta'') and privado.bh_pend_aberta(p.tipo, p.status) and privado.colaborador_vigente(c.id) and privado.modulo_ativo(''banco_horas'')',
    'where q.var >= 120 and privado.colaborador_vigente(c.id) and',
    'where q.var >= 120 and privado.colaborador_vigente(c.id) and privado.modulo_ativo(''banco_horas'') and'];
begin
  for i in 1..array_length(t, 1) by 2 loop
    n := (length(d) - length(replace(d, t[i], ''))) / length(t[i]);
    if n <> 1 then raise exception 'painel_pendencias mudou: trecho não encontrado: %', t[i]; end if;
    d := replace(d, t[i], t[i+1]);
  end loop;
  execute d;
end $$;
