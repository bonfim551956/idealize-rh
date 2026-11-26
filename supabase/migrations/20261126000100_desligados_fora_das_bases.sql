-- Desligado sai das bases do dia a dia (VT, banco de horas, pendências do painel, lista de advertências).
-- O histórico continua na ficha e na nova tela "Desligados".
-- "Em desligamento" continua nas bases: ainda trabalha (aviso prévio) até concluir.

create or replace function privado.colaborador_vigente(p_colaborador uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.vinculos v
                  where v.colaborador_id = p_colaborador and v.status not in ('desligado', 'arquivado'));
$$;

create or replace function privado.trocar_trecho(p_funcao regprocedure, p_de text, p_para text)
returns text language plpgsql as $$
declare d text := pg_get_functiondef(p_funcao); n int;
begin
  n := (length(d) - length(replace(d, p_de, ''))) / length(p_de);
  if n <> 1 then raise exception 'Trecho não encontrado (ou repetido) em %: %', p_funcao, left(p_de, 80); end if;
  return replace(d, p_de, p_para);
end $$;

do $$
declare d text; f regprocedure;
begin
  -- Vale-transporte: desligado só aparece no mês que já foi fechado com ele (histórico)
  f := 'public.vt_calculo(date,uuid)';
  d := privado.trocar_trecho(f, 'and (v.status <> ''desligado'' or v.data_desligamento >= par.a_ini)',
         'and (v.status <> ''desligado'' or exists (select 1 from public.vt_fechamentos fx where fx.colaborador_id = v.colaborador_id and fx.mes = par.m_ini))');
  execute d;

  -- Banco de horas: saldos e registros em aberto só de quem está na empresa
  f := 'public.banco_horas_resumo(uuid)';
  d := privado.trocar_trecho(f, E'left join pend pd on pd.nome_norm = u.nome_norm\n   where ',
         E'left join pend pd on pd.nome_norm = u.nome_norm\n   where privado.colaborador_vigente(c.id) and ');
  execute d;
  d := privado.trocar_trecho(f, 'where p.data >= current_date - 35 and privado.bh_pend_aberta(p.tipo, p.status)',
         'where p.data >= current_date - 35 and privado.bh_pend_aberta(p.tipo, p.status) and privado.colaborador_vigente(c.id)');
  execute d;

  -- Advertências: a lista geral mostra só quem está na empresa; a ficha (por colaborador) mostra tudo
  f := 'public.advertencias_listar(uuid,uuid)';
  d := privado.trocar_trecho(f, E'where not a.cancelada\n',
         E'where not a.cancelada and (p_colaborador is not null or privado.colaborador_vigente(c.id))\n');
  execute d;

  -- Painel de pendências
  f := 'public.painel_pendencias(uuid)';
  execute privado.trocar_trecho(f, 'where not a.cancelada and a.situacao = ''aguardando'' and a.data_aplicacao < current_date - 3',
         'where not a.cancelada and a.situacao = ''aguardando'' and a.data_aplicacao < current_date - 3 and privado.colaborador_vigente(c.id)');
  execute privado.trocar_trecho(f, 'where p.data >= current_date - 7 and p.tipo in (''registro_faltando'', ''falta'') and privado.bh_pend_aberta(p.tipo, p.status)',
         'where p.data >= current_date - 7 and p.tipo in (''registro_faltando'', ''falta'') and privado.bh_pend_aberta(p.tipo, p.status) and privado.colaborador_vigente(c.id)');
  execute privado.trocar_trecho(f, 'where q.var >= 120 and', 'where q.var >= 120 and privado.colaborador_vigente(c.id) and');
  execute privado.trocar_trecho(f, 'where a.tipo = ''ferias'' and not a.cancelada', 'where a.tipo = ''ferias'' and not a.cancelada and privado.colaborador_vigente(c.id)');
  execute privado.trocar_trecho(f, 'where e.documento_id is null and not e.cancelado and e.devolvido_em is null',
         'where e.documento_id is null and not e.cancelado and e.devolvido_em is null and privado.colaborador_vigente(c.id)');
end $$;

drop function privado.trocar_trecho(regprocedure, text, text);

-- Tela "Desligados": quem saiu, quando, como e quantos arquivos guardados
create or replace function public.desligados_listar(p_loja uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'colaborador_id', c.id, 'nome', coalesce(c.nome_social, c.nome_completo), 'loja_id', c.loja_atual_id, 'loja', l.nome,
      'cargo', cg.nome, 'matricula', v.matricula, 'admissao', v.data_admissao, 'desligamento', v.data_desligamento,
      'modalidade', dl.modalidade, 'ultimo_dia', dl.ultimo_dia,
      'documentos', (select count(*) from public.documentos d where d.colaborador_id = c.id and d.status <> 'arquivado'
                       and privado.pode_documento('ler', d.categoria_id, d.loja_id)))
      order by v.data_desligamento desc nulls last, c.nome_completo), '[]')
    from public.colaboradores c
    join lateral (select * from public.vinculos v where v.colaborador_id = c.id order by v.data_admissao desc nulls last limit 1) v on true
    join public.lojas l on l.id = c.loja_atual_id
    left join public.cargos cg on cg.id = v.cargo_id
    left join lateral (select d.modalidade, d.ultimo_dia from public.desligamentos d where d.vinculo_id = v.id order by d.data_comunicacao desc limit 1) dl on true
   where v.status = 'desligado' and not privado.colaborador_vigente(c.id)
     and (p_loja is null or c.loja_atual_id = p_loja) and privado.pode('colaborador.ler', c.loja_atual_id);
$$;
revoke all on function public.desligados_listar(uuid) from public, anon;
grant execute on function public.desligados_listar(uuid) to authenticated;
