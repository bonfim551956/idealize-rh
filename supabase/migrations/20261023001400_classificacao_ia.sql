-- =====================================================================
-- IDEALIZE RH 360º — Migração 014: apoio à classificação de documentos por IA
-- O agente SUGERE; quem envia confirma; a conferência continua humana.
-- =====================================================================

-- Dica por categoria: orienta o agente (editável, sem mexer em código)
alter table public.doc_categorias add column if not exists dica_ia text;

-- regra de ouro: a dica também é gravada em maiúsculas
create or replace trigger a_maiusculas before insert or update on public.doc_categorias
  for each row execute function privado.maiusculas('nome', 'retencao_observacao', 'dica_ia');
update public.doc_categorias set dica_ia = d.dica from (values
  ('documentos_pessoais',      'RG, CNH, CPF, título de eleitor, certidões (nascimento, casamento), comprovante de residência, carteira de trabalho (páginas de identificação), certificado de reservista, foto 3x4, documentos de dependentes'),
  ('admissao',                 'Ficha de registro de empregado, ficha cadastral, declaração de dependentes, termo de opção/recusa de vale-transporte, salário-família, declarações assinadas na admissão'),
  ('contratos',                'Contrato individual de trabalho (experiência, prazo indeterminado ou determinado), contrato de estágio (termo de compromisso), contrato de aprendizagem'),
  ('aditivos',                 'Aditivo ou alteração contratual, termo de prorrogação de experiência, alteração de jornada, função ou salário assinada'),
  ('jornada_ponto',            'Espelho de ponto, cartão de ponto, folha de ponto, relatório de banco de horas, acordo de compensação ou de banco de horas'),
  ('sst',                      'Certificado de treinamento de NR (NR-5, NR-6, NR-35 etc.), ficha de entrega de EPI, ordem de serviço de segurança, documentos de CIPA'),
  ('exames_ocupacionais',      'ASO (Atestado de Saúde Ocupacional) admissional, periódico, demissional, de retorno ao trabalho ou de mudança de função; exames complementares ocupacionais. Vencimento: data de validade do ASO'),
  ('ferias',                   'Aviso de férias, recibo de férias, solicitação ou programação de férias'),
  ('afastamentos_licencas',    'Atestado médico, declaração de comparecimento, licença-maternidade/paternidade, comunicação ou perícia do INSS, CAT (comunicação de acidente de trabalho)'),
  ('holerites_financeiros',    'Holerite, contracheque, recibo de pagamento de salário, adiantamento, comprovante de pagamento (PIX/TED) de salário, informe de rendimentos. Competência: mês de referência do pagamento'),
  ('advertencias_ocorrencias', 'Advertência, suspensão disciplinar, registro de ocorrência'),
  ('treinamentos',             'Certificado de curso ou treinamento (que não seja de NR), lista de presença de treinamento, certificado de integração'),
  ('avaliacoes',               'Avaliação de desempenho, avaliação do período de experiência, feedback formal'),
  ('comunicacao_interna',      'Comunicado interno, política ou regulamento interno assinado, termo de ciência, código de conduta assinado'),
  ('desligamento',             'Aviso prévio, pedido de demissão, TRCT (termo de rescisão), termo de quitação, homologação, guias e chave de saque do FGTS rescisório, seguro-desemprego'),
  ('juridicos',                'Processo trabalhista, notificação judicial ou extrajudicial, acordo judicial, procuração'),
  ('obrigacoes_trabalhistas',  'Guias de FGTS ou INSS, recibos do eSocial, DCTFWeb, CAGED, relatórios de obrigações da folha. Competência: mês de referência'),
  ('outros',                   'Somente se nenhuma outra categoria se aplicar')
) as d(codigo, dica)
where doc_categorias.codigo = d.codigo;

-- Localiza colaborador pelo CPF lido no documento, SÓ se quem pede pode vê-lo
create or replace function public.localizar_colaborador_por_cpf(p_cpf text)
returns table (id uuid, nome_completo text, loja_atual_id uuid, loja_nome text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.nome_completo, c.loja_atual_id, l.nome
    from public.colaboradores c
    join public.lojas l on l.id = c.loja_atual_id
   where c.cpf = privado.so_digitos(p_cpf)
     and privado.pode('colaborador.ler', c.loja_atual_id);
$$;
revoke all on function public.localizar_colaborador_por_cpf(text) from public, anon;
grant execute on function public.localizar_colaborador_por_cpf(text) to authenticated;

-- Registra cada sugestão feita pela IA na auditoria (sem conteúdo do documento)
create or replace function public.registrar_sugestao_ia(p_contexto jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.usuarios where id = auth.uid() and ativo) then
    raise exception 'Usuário inválido' using errcode = '42501';
  end if;
  perform privado.registrar_evento('CLASSIFICACAO_IA', 'documentos', null,
    nullif(p_contexto ->> 'loja_id', '')::uuid,
    jsonb_strip_nulls(jsonb_build_object(
      'arquivo', left(p_contexto ->> 'arquivo', 200),
      'categoria_sugerida', p_contexto ->> 'categoria_sugerida',
      'confianca', p_contexto ->> 'confianca',
      'colaborador_encontrado', (p_contexto ->> 'colaborador_encontrado')::boolean,
      'modelo', p_contexto ->> 'modelo')));
end $$;
revoke all on function public.registrar_sugestao_ia(jsonb) from public, anon;
grant execute on function public.registrar_sugestao_ia(jsonb) to authenticated;
