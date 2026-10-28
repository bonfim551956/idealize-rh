-- =====================================================================
-- IDEALIZE RH 360º — Pendências do RH no painel principal
-- Uma lista única do que precisa de ação, cada item com quantidade,
-- gravidade, onde resolver e até 6 exemplos. Cada pendência só aparece
-- para quem tem a permissão correspondente, e só das lojas do seu acesso.
-- =====================================================================
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
  if n > 0 then r := r || jsonb_build_object('chave', 'ferias', 'titulo', 'Férias a vencer', 'gravidade',
    case when exists (select 1 from jsonb_array_elements(av->'ferias') f where (f->>'dias')::int < 0) then 'alta' else 'media' end,
    'quantidade', n, 'link', '/', 'acao', 'Programar férias', 'itens', itens); end if;

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
