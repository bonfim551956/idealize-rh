-- "Documentos vencidos / vencendo" só para o que de fato se renova:
--  * categoria marcada como "exige vencimento" (ex.: ASO). Guias, holerites e
--    atestados têm data de vencimento/pagamento, mas não são renovados.
--  * colaborador ainda na empresa (desligado ou em desligamento não renova nada).
--    Documento sem colaborador (da empresa) continua valendo.

create or replace function privado.doc_exige_renovacao(p_categoria uuid, p_colaborador uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select k.exige_vencimento from public.doc_categorias k where k.id = p_categoria), false)
     and (p_colaborador is null or exists (
           select 1 from public.vinculos v
            where v.colaborador_id = p_colaborador and v.status not in ('desligado', 'em_desligamento')));
$$;

do $$
declare d text; a text; b text;
begin
  d := pg_get_functiondef('public.painel_pendencias(uuid)'::regprocedure);
  a := 'where d.vencimento < current_date and d.status not in (''arquivado'', ''reprovado'')';
  b := 'where d.vencimento between current_date and current_date + 30 and d.status not in (''arquivado'', ''vencido'', ''reprovado'')';
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 or (length(d) - length(replace(d, b, ''))) / length(b) <> 1 then
    raise exception 'painel_pendencias mudou: trechos de documentos vencidos não encontrados';
  end if;
  d := replace(d, a, a || ' and privado.doc_exige_renovacao(d.categoria_id, d.colaborador_id)');
  d := replace(d, b, b || ' and privado.doc_exige_renovacao(d.categoria_id, d.colaborador_id)');
  execute d;
end $$;

create or replace function public.dashboard_resumo(p_loja uuid default null)
returns jsonb language sql stable set search_path = '' as $$
  with col as (
    select c.id, c.loja_atual_id, v.status, v.data_admissao, v.data_desligamento
      from public.colaboradores c
      join public.vinculos v on v.colaborador_id = c.id
     where p_loja is null or c.loja_atual_id = p_loja
  ), docs as (
    select d.status, d.vencimento, privado.doc_exige_renovacao(d.categoria_id, d.colaborador_id) as renova
      from public.documentos d
     where p_loja is null or d.loja_id = p_loja
  )
  select jsonb_build_object(
    'colaboradores_ativos', (select count(*) from col where status in ('ativo','em_ferias','afastado','em_licenca')),
    'por_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from col group by status) s), '{}'::jsonb),
    'por_loja', coalesce((select jsonb_agg(jsonb_build_object('loja_id', l.id, 'loja', l.nome, 'ativos', coalesce(x.n, 0)) order by l.nome)
                   from public.lojas l
                   left join (select loja_atual_id, count(*) n from col
                               where status in ('ativo','em_ferias','afastado','em_licenca') group by loja_atual_id) x
                     on x.loja_atual_id = l.id
                  where l.ativa and (p_loja is null or l.id = p_loja)), '[]'::jsonb),
    'admissoes_12m', (select count(*) from col where data_admissao >= current_date - interval '12 months'),
    'desligamentos_12m', (select count(*) from col where data_desligamento >= current_date - interval '12 months'),
    'documentos_pendentes_conferencia', (select count(*) from docs where status in ('recebido','em_conferencia')),
    'documentos_pendentes', (select count(*) from docs where status = 'pendente'),
    'documentos_aguardando_assinatura', (select count(*) from docs where status = 'aguardando_assinatura'),
    'documentos_vencendo_30d', (select count(*) from docs where renova and vencimento between current_date and current_date + 30
                                  and status not in ('arquivado','vencido','reprovado')),
    'documentos_vencidos', (select count(*) from docs where renova and vencimento < current_date and status not in ('arquivado','reprovado')),
    'tarefas_abertas', (select count(*) from public.tarefas t where t.status in ('aberta','em_andamento')
                          and (p_loja is null or t.loja_id = p_loja)),
    'gerado_em', now()
  );
$$;
revoke all on function public.dashboard_resumo(uuid) from public, anon;
grant execute on function public.dashboard_resumo(uuid) to authenticated;
