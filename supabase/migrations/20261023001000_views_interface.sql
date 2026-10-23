-- =====================================================================
-- IDEALIZE RH 360º — Migração 010: views para a interface
-- security_invoker = true: a view roda com as permissões de quem consulta,
-- então RLS e privilégios de coluna continuam valendo integralmente.
-- =====================================================================

create view public.v_colaboradores with (security_invoker = true) as
select c.id, c.nome_completo, c.nome_social, c.cpf_mascarado, c.loja_atual_id,
       l.nome as loja_nome, l.codigo as loja_codigo,
       v.id as vinculo_id, v.empresa_id, v.matricula, v.tipo, v.status, v.data_admissao, v.data_desligamento,
       v.cargo_id, cg.nome as cargo_nome, v.jornada_semanal_horas, v.escala,
       c.criado_em
  from public.colaboradores c
  join public.lojas l on l.id = c.loja_atual_id
  left join lateral (
    select vv.* from public.vinculos vv
     where vv.colaborador_id = c.id
     order by (vv.status in ('desligado', 'arquivado')), vv.criado_em desc
     limit 1
  ) v on true
  left join public.cargos cg on cg.id = v.cargo_id;

create view public.v_documentos with (security_invoker = true) as
select d.id, d.nome, d.categoria_id, cat.nome as categoria_nome, cat.nivel_sigilo,
       d.colaborador_id, col.nome_completo as colaborador_nome,
       d.loja_id, l.nome as loja_nome,
       d.data_emissao, d.data_recebimento, d.competencia, d.vencimento,
       d.status, d.status_assinatura, d.versao_atual, d.observacoes,
       d.enviado_por, d.conferido_por, d.conferido_em, d.criado_em, d.atualizado_em
  from public.documentos d
  join public.doc_categorias cat on cat.id = d.categoria_id
  join public.lojas l on l.id = d.loja_id
  left join public.colaboradores col on col.id = d.colaborador_id;

revoke all on public.v_colaboradores, public.v_documentos from anon, public;
grant select on public.v_colaboradores, public.v_documentos to authenticated;
