-- =====================================================================
-- IDEALIZE RH 360º — Migração 007: dashboard, catálogo de permissões,
-- perfis, configuração inicial (empresas, lojas, cargos, categorias)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Dashboard (SECURITY INVOKER: só conta o que a RLS deixa o usuário ver)
-- ---------------------------------------------------------------------
create or replace function public.dashboard_resumo(p_loja uuid default null)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with col as (
    select c.id, c.loja_atual_id, v.status, v.data_admissao, v.data_desligamento
      from public.colaboradores c
      join public.vinculos v on v.colaborador_id = c.id
     where p_loja is null or c.loja_atual_id = p_loja
  ), docs as (
    select d.status, d.vencimento from public.documentos d
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
    'documentos_vencendo_30d', (select count(*) from docs where vencimento between current_date and current_date + 30
                                  and status not in ('arquivado','vencido')),
    'documentos_vencidos', (select count(*) from docs where vencimento < current_date and status not in ('arquivado')),
    'tarefas_abertas', (select count(*) from public.tarefas t where t.status in ('aberta','em_andamento')
                          and (p_loja is null or t.loja_id = p_loja)),
    'gerado_em', now()
  );
$$;
revoke all on function public.dashboard_resumo(uuid) from public, anon;
grant execute on function public.dashboard_resumo(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Catálogo de permissões
-- ---------------------------------------------------------------------
insert into public.permissoes (codigo, modulo, descricao, exige_mfa, sensivel) values
  ('config.estrutura.gerir',            'configuracao', 'Cadastrar/editar empresas, lojas, cargos, departamentos e categorias', false, false),
  ('acesso.gerir',                      'acesso',       'Conceder e revogar acessos de usuários',                               true,  true),
  ('auditoria.ler',                     'auditoria',    'Consultar registros de auditoria e de acesso a documentos',            true,  true),
  ('dashboard.ver',                     'dashboard',    'Ver o painel de indicadores',                                          false, false),
  ('colaborador.ler',                   'pessoas',      'Ver cadastro básico (nome, loja, cargo, status, CPF mascarado)',       false, false),
  ('colaborador.criar',                 'pessoas',      'Cadastrar colaboradores',                                              false, false),
  ('colaborador.editar',                'pessoas',      'Editar dados profissionais do vínculo',                                false, false),
  ('colaborador.dados_pessoais.ler',    'pessoas',      'Ver CPF, nascimento, endereço e contatos completos',                   true,  true),
  ('colaborador.dados_pessoais.editar', 'pessoas',      'Editar dados pessoais',                                                true,  true),
  ('colaborador.transferir',            'pessoas',      'Transferir colaborador entre lojas (origem e destino)',                false, false),
  ('vinculo.status.alterar',            'pessoas',      'Mudar status do vínculo',                                              false, false),
  ('cargo.alterar',                     'pessoas',      'Registrar promoções e mudanças de função',                             false, false),
  ('desligamento.gerir',                'pessoas',      'Iniciar e concluir desligamentos',                                     true,  true),
  ('remuneracao.ler',                   'remuneracao',  'Ver salários e histórico salarial',                                    true,  true),
  ('remuneracao.gerir',                 'remuneracao',  'Registrar alterações salariais',                                       true,  true),
  ('documento.conferir',                'documentos',   'Aprovar ou reprovar documentos',                                       false, false),
  ('documento.arquivar',                'documentos',   'Arquivar documentos',                                                  false, false),
  ('tarefa.ler',                        'tarefas',      'Ver tarefas da loja',                                                  false, false),
  ('tarefa.gerir',                      'tarefas',      'Criar e editar tarefas da loja',                                       false, false),
  ('relatorio.exportar',                'relatorios',   'Exportar relatórios com dados pessoais',                               true,  true)
on conflict (codigo) do nothing;

insert into public.permissoes (codigo, modulo, descricao, exige_mfa, sensivel)
select 'documento.' || n.nivel || '.' || a.acao, 'documentos',
       initcap(a.acao) || ' documentos de sigilo "' || n.nivel || '"',
       n.nivel in ('saude','financeiro','disciplinar','juridico'),
       n.nivel <> 'geral'
  from (values ('geral'),('pessoal'),('contratual'),('saude'),('financeiro'),('disciplinar'),('juridico')) n(nivel)
 cross join (values ('ler'),('enviar')) a(acao)
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------------
-- Perfis iniciais (permissões editáveis depois)
-- ---------------------------------------------------------------------
insert into public.perfis (codigo, nome, descricao, de_sistema) values
  ('admin_tecnico',        'Administrador técnico', 'Configura a estrutura do sistema. NÃO acessa dados nem documentos pessoais.', true),
  ('diretoria',            'Proprietário / Diretoria', 'Acesso total, com MFA para dados sensíveis.', true),
  ('rh_central',           'RH central', 'Gestão completa de pessoas de todas as lojas.', true),
  ('departamento_pessoal', 'Departamento Pessoal', 'Rotinas de DP: cadastros, documentos, salários, desligamentos.', true),
  ('gerente_loja',         'Gerente de loja', 'Visão básica da equipe da própria loja e documentos gerais.', true),
  ('juridico',             'Jurídico', 'Leitura ampla para casos atribuídos (escopo por loja).', true),
  ('contabilidade',        'Contabilidade (externa)', 'Dados e documentos necessários à folha e obrigações.', true),
  ('colaborador',          'Colaborador', 'Portal do colaborador (Etapa 5). Sem permissões por enquanto.', true)
on conflict (codigo) do nothing;

-- Diretoria e RH central: tudo
insert into public.perfil_permissoes (perfil_id, permissao)
select p.id, pe.codigo from public.perfis p cross join public.permissoes pe
 where p.codigo in ('diretoria', 'rh_central')
on conflict do nothing;

-- Administrador técnico: só estrutura
insert into public.perfil_permissoes (perfil_id, permissao)
select p.id, 'config.estrutura.gerir' from public.perfis p where p.codigo = 'admin_tecnico'
on conflict do nothing;

-- Departamento Pessoal
insert into public.perfil_permissoes (perfil_id, permissao)
select p.id, pe.codigo from public.perfis p cross join public.permissoes pe
 where p.codigo = 'departamento_pessoal'
   and pe.codigo not in ('acesso.gerir', 'auditoria.ler', 'config.estrutura.gerir',
                         'documento.disciplinar.enviar', 'documento.juridico.ler', 'documento.juridico.enviar')
on conflict do nothing;

-- Gerente de loja (sempre com loja definida na atribuição)
insert into public.perfil_permissoes (perfil_id, permissao)
select p.id, x from public.perfis p,
  unnest(array['dashboard.ver', 'colaborador.ler', 'documento.geral.ler', 'documento.geral.enviar',
               'tarefa.ler', 'tarefa.gerir']) x
 where p.codigo = 'gerente_loja'
on conflict do nothing;

-- Jurídico
insert into public.perfil_permissoes (perfil_id, permissao)
select p.id, pe.codigo from public.perfis p cross join public.permissoes pe
 where p.codigo = 'juridico'
   and (pe.codigo in ('colaborador.ler', 'colaborador.dados_pessoais.ler', 'remuneracao.ler')
        or pe.codigo like 'documento.%.ler')
on conflict do nothing;

-- Contabilidade externa
insert into public.perfil_permissoes (perfil_id, permissao)
select p.id, x from public.perfis p,
  unnest(array['colaborador.ler', 'colaborador.dados_pessoais.ler', 'remuneracao.ler',
               'documento.geral.ler', 'documento.pessoal.ler', 'documento.contratual.ler', 'documento.contratual.enviar',
               'documento.financeiro.ler', 'documento.financeiro.enviar']) x
 where p.codigo = 'contabilidade'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Máquina de estados do vínculo
-- ---------------------------------------------------------------------
insert into public.status_transicoes (de, para, requisito) values
  ('pre_admissao',    'em_admissao',     null),
  ('pre_admissao',    'arquivado',       null),
  ('em_admissao',     'ativo',           null),
  ('em_admissao',     'pre_admissao',    null),
  ('em_admissao',     'arquivado',       null),
  ('ativo',           'em_ferias',       null),
  ('ativo',           'afastado',        null),
  ('ativo',           'em_licenca',      null),
  ('ativo',           'em_desligamento', null),
  ('em_ferias',       'ativo',           null),
  ('afastado',        'ativo',           null),
  ('afastado',        'em_desligamento', null),
  ('em_licenca',      'ativo',           null),
  ('em_licenca',      'em_desligamento', null),
  ('em_desligamento', 'ativo',           null),
  ('em_desligamento', 'desligado',       'desligamento_concluido'),
  ('desligado',       'arquivado',       null)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Categorias documentais (retenção: PROVISÓRIA, sem validação jurídica)
-- ---------------------------------------------------------------------
insert into public.doc_categorias (codigo, nome, nivel_sigilo, exige_vencimento, exige_competencia, retencao_observacao) values
  ('documentos_pessoais',     'Documentos pessoais',               'pessoal',     false, false, 'Prazo de retenção a validar com contabilidade/jurídico'),
  ('admissao',                'Admissão',                          'contratual',  false, false, 'Prazo de retenção a validar com contabilidade/jurídico'),
  ('contratos',               'Contratos',                         'contratual',  false, false, 'Prazo de retenção a validar com contabilidade/jurídico'),
  ('aditivos',                'Aditivos contratuais',              'contratual',  false, false, 'Prazo de retenção a validar com contabilidade/jurídico'),
  ('jornada_ponto',           'Jornada e ponto',                   'geral',       false, true,  'Prazo de retenção a validar com contabilidade/jurídico'),
  ('sst',                     'Saúde e segurança do trabalho',     'geral',       false, false, 'Prazo de retenção a validar com contabilidade/jurídico'),
  ('exames_ocupacionais',     'Exames ocupacionais',               'saude',       true,  false, 'Prazo de retenção a validar com contabilidade/jurídico'),
  ('ferias',                  'Férias',                            'contratual',  false, false, 'Prazo de retenção a validar com contabilidade/jurídico'),
  ('afastamentos_licencas',   'Afastamentos e licenças',           'saude',       false, false, 'Prazo de retenção a validar com contabilidade/jurídico'),
  ('holerites_financeiros',   'Holerites e documentos financeiros','financeiro',  false, true,  'Prazo de retenção a validar com contabilidade/jurídico'),
  ('advertencias_ocorrencias','Advertências e ocorrências',        'disciplinar', false, false, 'Prazo de retenção a validar com contabilidade/jurídico'),
  ('treinamentos',            'Treinamentos',                      'geral',       false, false, 'Prazo de retenção a validar com contabilidade/jurídico'),
  ('avaliacoes',              'Avaliações',                        'pessoal',     false, false, 'Prazo de retenção a validar com contabilidade/jurídico'),
  ('comunicacao_interna',     'Comunicação interna',               'geral',       false, false, 'Prazo de retenção a validar com contabilidade/jurídico'),
  ('desligamento',            'Desligamento',                      'contratual',  false, false, 'Prazo de retenção a validar com contabilidade/jurídico'),
  ('juridicos',               'Documentos jurídicos',              'juridico',    false, false, 'Prazo de retenção a validar com contabilidade/jurídico'),
  ('obrigacoes_trabalhistas', 'Obrigações trabalhistas',           'contratual',  false, true,  'Prazo de retenção a validar com contabilidade/jurídico'),
  ('outros',                  'Outros documentos autorizados',     'pessoal',     false, false, 'Prazo de retenção a validar com contabilidade/jurídico')
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------------
-- Empresas e lojas (dados informados pela empresa; confira no sistema)
-- ---------------------------------------------------------------------
insert into public.empresas (cnpj, razao_social, dados_confirmados, observacao) values
  ('43331384000138', 'RF Silva Ótica ME',                    true,  null),
  ('51885847000131', 'RM Comércio Ótico Ltda',               true,  null),
  ('66317708000189', 'Óticas Idealize Piracicaba Ltda',      true,  null),
  ('58849594000190', 'Idealize Comércio Óptico do Litoral',  false, 'CNPJ informado; razão social completa (tipo societário) a confirmar')
on conflict (cnpj) do nothing;

insert into public.lojas (empresa_id, codigo, nome, cidade, uf, endereco, cep, telefone, dados_confirmados, observacao)
select e.id, x.codigo, x.nome, x.cidade, 'SP', x.endereco, x.cep, x.telefone, x.conf, x.obs
  from (values
    ('43331384000138', 'CAMPINAS',   'Óticas Idealize Campinas',   'Campinas',   'R. Barão de Jaguara, 1164 - Centro',                         '13015002', '19995803876', true,  null),
    ('51885847000131', 'SOROCABA',   'Óticas Idealize Sorocaba',   'Sorocaba',   'Av. Comendador Hermelino Matarazzo, 471 - Vila Santa Rita',  '18080000', '15997729718', true,  null),
    ('66317708000189', 'PIRACICABA', 'Óticas Idealize Piracicaba', 'Piracicaba', 'R. Benjamin Constant, 1379 - Centro',                         '13400053', null,          true,  null),
    ('58849594000190', 'SAOVICENTE', 'Óticas Idealize São Vicente','São Vicente','Av. Antônio Emmerich, 481 - Vila Melo',                        null,       '13996499669', false, 'CEP a completar')
  ) as x(cnpj, codigo, nome, cidade, endereco, cep, telefone, conf, obs)
  join public.empresas e on e.cnpj = x.cnpj
on conflict (codigo) do nothing;

-- Cargos iniciais (editáveis)
insert into public.cargos (nome) values
  ('Consultor(a) de vendas'), ('Gerente de loja'), ('Atendente'), ('Administrativo')
on conflict (nome) do nothing;

-- ---------------------------------------------------------------------
-- Bootstrap do primeiro administrador (só funciona uma vez e só pelo
-- dono do banco / SQL editor, nunca pela API)
-- ---------------------------------------------------------------------
create or replace function privado.bootstrap_diretoria(p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  if exists (select 1 from public.usuario_atribuicoes) then
    raise exception 'Bootstrap já realizado: use conceder_acesso()';
  end if;
  select id into v_uid from public.usuarios where lower(email) = lower(p_email);
  if v_uid is null then raise exception 'Usuário % não encontrado em public.usuarios', p_email; end if;
  insert into public.usuario_atribuicoes (usuario_id, perfil_id, loja_id, motivo)
  select v_uid, id, null, 'Bootstrap inicial' from public.perfis where codigo = 'diretoria';
end $$;
revoke all on function privado.bootstrap_diretoria(text) from public, anon, authenticated;

-- Garantia final: anon não acessa nenhuma tabela
revoke all on all tables in schema public from anon;
