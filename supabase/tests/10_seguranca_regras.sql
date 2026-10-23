-- =====================================================================
-- Testes de segurança e regras de negócio — Etapa 1
-- Roda no banco local (stub) E no projeto Supabase real (dentro de
-- uma transação com ROLLBACK, sem deixar dados).
-- Cada teste que falha interrompe a execução com a mensagem do teste.
-- =====================================================================
begin;

create schema teste;
grant usage on schema teste to authenticated, anon;
create table teste.ctx (k text primary key, v text);
grant select on teste.ctx to authenticated, anon;

create function teste.ok(p boolean, msg text) returns void language plpgsql as $$
begin
  if p is not true then raise exception 'FALHOU: %', msg; end if;
  raise notice 'ok  - %', msg;
end $$;

-- executa SQL que DEVE falhar
create function teste.nega(p_sql text, msg text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'ok  - % (bloqueado: %)', msg, left(sqlerrm, 90);
    return;
  end;
  raise exception 'FALHOU: % — a operação deveria ter sido bloqueada', msg;
end $$;

create function teste.id(p text) returns uuid language sql stable as $$ select v::uuid from teste.ctx where k = p $$;

-- simula login: define o JWT da requisição
create function teste.login(p_email text, p_aal text default 'aal2') returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email), 'role', 'authenticated', 'aal', p_aal)::text, true);
end $$;
grant execute on all functions in schema teste to authenticated, anon;

-- ---------------------------------------------------------------------
-- Preparação: usuários do Auth (o trigger cria public.usuarios)
-- ---------------------------------------------------------------------
insert into auth.users (email, raw_user_meta_data) values
  ('diretor@teste.local',   '{"nome":"Diretor Teste"}'),
  ('dp@teste.local',        '{"nome":"DP Teste"}'),
  ('gerente.soro@teste.local', '{"nome":"Gerente Sorocaba"}'),
  ('gerente.camp@teste.local', '{"nome":"Gerente Campinas"}'),
  ('admin@teste.local',     '{"nome":"Admin Técnico"}'),
  ('contabil@teste.local',  '{"nome":"Contabilidade"}'),
  ('semperfil@teste.local', '{"nome":"Sem Perfil"}');

select teste.ok((select count(*) from public.usuarios where email like '%@teste.local') = 7,
  'trigger do Auth cria public.usuarios para cada usuário novo');

select privado.bootstrap_diretoria('diretor@teste.local');
select teste.nega($$select privado.bootstrap_diretoria('dp@teste.local')$$, 'bootstrap só funciona uma vez');

insert into teste.ctx values
  ('soro',  (select id::text from public.lojas where codigo = 'SOROCABA')),
  ('camp',  (select id::text from public.lojas where codigo = 'CAMPINAS')),
  ('cargo', (select id::text from public.cargos where nome = 'Consultor(a) de vendas')),
  ('cat_saude', (select id::text from public.doc_categorias where codigo = 'exames_ocupacionais')),
  ('cat_geral', (select id::text from public.doc_categorias where codigo = 'treinamentos')),
  ('u_dp',  (select id::text from public.usuarios where email = 'dp@teste.local')),
  ('u_gs',  (select id::text from public.usuarios where email = 'gerente.soro@teste.local')),
  ('u_gc',  (select id::text from public.usuarios where email = 'gerente.camp@teste.local')),
  ('u_adm', (select id::text from public.usuarios where email = 'admin@teste.local')),
  ('u_ct',  (select id::text from public.usuarios where email = 'contabil@teste.local')),
  ('u_dir', (select id::text from public.usuarios where email = 'diretor@teste.local'));

-- ---------------------------------------------------------------------
-- 1. Concessão de acessos
-- ---------------------------------------------------------------------
set role authenticated;
select teste.login('diretor@teste.local', 'aal1');
select teste.nega($$select public.conceder_acesso(teste.id('u_dp'), 'departamento_pessoal')$$,
  'conceder acesso exige MFA (sessão aal1 bloqueada)');

select teste.login('diretor@teste.local', 'aal2');
select public.conceder_acesso(teste.id('u_dp'),  'departamento_pessoal');
select public.conceder_acesso(teste.id('u_gs'),  'gerente_loja', teste.id('soro'));
select public.conceder_acesso(teste.id('u_gc'),  'gerente_loja', teste.id('camp'));
select public.conceder_acesso(teste.id('u_adm'), 'admin_tecnico');
select public.conceder_acesso(teste.id('u_ct'),  'contabilidade', teste.id('soro'));
select teste.nega($$select public.conceder_acesso(teste.id('u_dir'), 'rh_central')$$, 'ninguém concede acesso a si mesmo');
select teste.nega($$select public.conceder_acesso(teste.id('u_gc'), 'gerente_loja')$$, 'gerente de loja exige loja definida');

-- ---------------------------------------------------------------------
-- 2. Cadastro de colaboradores (DP com MFA)
-- ---------------------------------------------------------------------
select teste.login('dp@teste.local', 'aal2');
select teste.nega($$select public.cadastrar_colaborador('{"nome_completo":"CPF Inválido","cpf":"12345678900","loja_id":"$$ || teste.id('soro') || $$","matricula":"X1","tipo":"clt_prazo_indeterminado"}')$$,
  'CPF inválido é rejeitado');

do $$ begin
  perform set_config('teste.a', public.cadastrar_colaborador(jsonb_build_object(
    'nome_completo', 'Ana Sorocaba', 'cpf', '529.982.247-25', 'loja_id', teste.id('soro'),
    'matricula', 'S001', 'tipo', 'clt_prazo_indeterminado', 'status_inicial', 'ativo',
    'data_admissao', '2025-03-10', 'cargo_id', teste.id('cargo'), 'salario_base', '2500.00',
    'telefone', '(15) 99999-0000'))::text, false);
  perform set_config('teste.b', public.cadastrar_colaborador(jsonb_build_object(
    'nome_completo', 'Bruno Campinas', 'cpf', '111.444.777-35', 'loja_id', teste.id('camp'),
    'matricula', 'C001', 'tipo', 'clt_prazo_indeterminado', 'status_inicial', 'ativo',
    'data_admissao', '2024-08-01', 'cargo_id', teste.id('cargo'), 'salario_base', '2300.00'))::text, false);
end $$;
reset role;
insert into teste.ctx values ('col_a', current_setting('teste.a')), ('col_b', current_setting('teste.b')),
  ('vinc_a', (select id::text from public.vinculos where colaborador_id = current_setting('teste.a')::uuid)),
  ('vinc_b', (select id::text from public.vinculos where colaborador_id = current_setting('teste.b')::uuid));
set role authenticated;

select teste.nega($$select public.cadastrar_colaborador('{"nome_completo":"Duplicada","cpf":"52998224725","loja_id":"$$ || teste.id('soro') || $$","matricula":"S009","tipo":"clt_prazo_indeterminado"}')$$,
  'CPF duplicado é rejeitado');

select teste.login('dp@teste.local', 'aal1');
select teste.nega($$select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Sem MFA','cpf','39053344705','loja_id',teste.id('soro'),'matricula','S010','tipo','clt_prazo_indeterminado','salario_base','2000'))$$,
  'registrar salário sem MFA é bloqueado');
select teste.ok((select count(*) from public.remuneracoes) = 0, 'DP sem MFA não vê salários');
select teste.ok((select count(*) from public.colaboradores) = 2, 'DP sem MFA ainda vê o cadastro básico');

-- ---------------------------------------------------------------------
-- 3. ISOLAMENTO ENTRE LOJAS — gerente de Sorocaba
-- ---------------------------------------------------------------------
select teste.login('gerente.soro@teste.local', 'aal2');
select teste.ok((select count(*) from public.colaboradores) = 1, 'gerente de Sorocaba vê só 1 colaborador (o da própria loja)');
select teste.ok((select count(*) from public.colaboradores where id = teste.id('col_b')) = 0, 'gerente de Sorocaba NÃO vê colaborador de Campinas nem buscando pelo ID');
select teste.ok((select count(*) from public.vinculos where id = teste.id('vinc_b')) = 0, 'gerente de Sorocaba NÃO vê vínculo de Campinas');
select teste.ok((select count(*) from public.lotacoes) = 1, 'gerente de Sorocaba vê só lotações da própria loja');
select teste.ok((select count(*) from public.lojas) = 1, 'gerente de Sorocaba vê só a própria loja');
select teste.nega($$select cpf from public.colaboradores$$, 'gerente não lê a coluna CPF completa');
select teste.ok((select cpf_mascarado from public.colaboradores limit 1) = '***.982.247-**', 'gerente vê CPF mascarado');
select teste.ok(public.colaborador_dados_pessoais(teste.id('col_a')) is null, 'gerente não lê dados pessoais nem da própria loja');
select teste.ok((select count(*) from public.remuneracoes) = 0, 'gerente não vê salários');
select teste.ok((select count(*) from public.eventos_timeline where sigilo <> 'geral') = 0, 'gerente não vê eventos sigilosos na linha do tempo');
select teste.nega($$select public.cadastrar_colaborador(jsonb_build_object('nome_completo','X','cpf','39053344705','loja_id',teste.id('soro'),'matricula','S011','tipo','clt_prazo_indeterminado'))$$,
  'gerente não cadastra colaborador');
select teste.nega($$select public.transferir_colaborador(teste.id('col_a'), teste.id('camp'), current_date, 'teste')$$, 'gerente não transfere');
select teste.nega($$select public.alterar_status_vinculo(teste.id('vinc_a'), 'em_ferias', 'teste')$$, 'gerente não altera status');
select teste.nega($$update public.vinculos set status = 'desligado' where id = teste.id('vinc_a')$$, 'UPDATE direto em vínculo bloqueado');
select teste.nega($$insert into public.colaboradores (nome_completo, cpf, loja_atual_id) values ('Hack','39053344705',teste.id('soro'))$$, 'INSERT direto em colaboradores bloqueado');
select teste.nega($$delete from public.colaboradores$$, 'DELETE em colaboradores bloqueado');
select teste.nega($$select public.conceder_acesso(teste.id('u_gs'), 'diretoria')$$, 'gerente não se promove a diretoria');

-- ---------------------------------------------------------------------
-- 4. Contabilidade com escopo só em Sorocaba
-- ---------------------------------------------------------------------
select teste.login('contabil@teste.local', 'aal2');
select teste.ok((select count(*) from public.colaboradores) = 1, 'contabilidade (escopo Sorocaba) vê só Sorocaba');
select teste.ok((select count(*) from public.remuneracoes) = 1, 'contabilidade vê salário da loja do seu escopo');
select teste.ok((public.colaborador_dados_pessoais(teste.id('col_a')) ->> 'cpf') = '52998224725', 'contabilidade lê dados pessoais (auditado)');
select teste.ok(public.colaborador_dados_pessoais(teste.id('col_b')) is null, 'contabilidade NÃO lê dados pessoais de Campinas');

-- ---------------------------------------------------------------------
-- 5. Administrador técnico: configura, mas não enxerga pessoas
-- ---------------------------------------------------------------------
select teste.login('admin@teste.local', 'aal2');
insert into public.lojas (empresa_id, codigo, nome, cidade, uf)
  select empresa_id, 'SOROCABA2', 'Loja Teste Sorocaba 2', 'Sorocaba', 'SP' from public.lojas where codigo = 'SOROCABA';
select teste.ok((select count(*) from public.lojas where codigo = 'SOROCABA2') = 1, 'admin técnico cadastra nova loja');
select teste.ok((select count(*) from public.colaboradores) = 0, 'admin técnico NÃO vê colaboradores');
select teste.ok((select count(*) from public.documentos) = 0, 'admin técnico NÃO vê documentos');
select teste.ok((select count(*) from public.audit_log) = 0, 'admin técnico NÃO lê auditoria');
select teste.nega($$select public.conceder_acesso(teste.id('u_adm'), 'diretoria')$$, 'admin técnico não se concede diretoria');
select teste.nega($$select public.conceder_acesso(teste.id('u_gs'), 'rh_central')$$, 'admin técnico não concede perfis');

-- usuário sem perfil
select teste.login('semperfil@teste.local', 'aal2');
select teste.ok((select count(*) from public.colaboradores) = 0 and (select count(*) from public.lojas) = 0,
  'usuário autenticado sem perfil não vê nada');

-- ---------------------------------------------------------------------
-- 6. Documentos
-- ---------------------------------------------------------------------
select teste.login('dp@teste.local', 'aal2');
do $$ declare r record; begin
  select * into r from public.documento_preparar_upload(null,
    jsonb_build_object('nome','ASO admissional','categoria_id',teste.id('cat_saude'),'colaborador_id',teste.id('col_a'),'vencimento','2026-12-31'),
    'aso.pdf', 'application/pdf', 1024, repeat('a', 64));
  perform set_config('teste.doc_saude', r.documento_id::text, false);
  perform set_config('teste.ver_saude', r.versao_id::text, false);
  perform public.documento_confirmar_upload(r.versao_id);
end $$;
select teste.ok((select status::text from public.documentos where id = current_setting('teste.doc_saude')::uuid) = 'recebido',
  'documento enviado fica "recebido" — não aprovado');
select teste.nega($$update public.documentos set status = 'aprovado' where id = current_setting('teste.doc_saude')::uuid$$,
  'aprovar documento por UPDATE direto é bloqueado');
select teste.nega($$select public.documento_conferir(current_setting('teste.doc_saude')::uuid, false, null)$$, 'reprovar exige motivo');
select public.documento_conferir(current_setting('teste.doc_saude')::uuid, true, null);
select teste.ok((select status::text from public.documentos where id = current_setting('teste.doc_saude')::uuid) = 'aprovado',
  'documento aprovado pela função de conferência');
select teste.ok((select storage_path from public.documento_autorizar_acesso(current_setting('teste.doc_saude')::uuid)) like '%/v1-%',
  'DP autorizado a baixar ASO (gera caminho para URL assinada)');
select teste.nega($$select * from public.documento_preparar_upload(current_setting('teste.doc_saude')::uuid, '{}', 'aso2.pdf','application/pdf',10, repeat('b',64), null)$$,
  'nova versão exige motivo da substituição');

select teste.login('gerente.soro@teste.local', 'aal2');
select teste.ok((select count(*) from public.documentos) = 0, 'gerente NÃO vê exame ocupacional (sigilo saúde) nem da própria loja');
select teste.ok((select count(*) from public.documento_autorizar_acesso(current_setting('teste.doc_saude')::uuid)) = 0, 'gerente NÃO baixa exame ocupacional');
select teste.ok((select count(*) from public.documento_preparar_upload(null, jsonb_build_object('nome','x','categoria_id',teste.id('cat_saude'),'colaborador_id',teste.id('col_a'),'vencimento','2027-01-01'), 'x.pdf','application/pdf',10, repeat('c',64))) = 0,
  'gerente NÃO envia documento de saúde');
do $$ declare r record; begin
  select * into r from public.documento_preparar_upload(null,
    jsonb_build_object('nome','Certificado treinamento','categoria_id',teste.id('cat_geral'),'colaborador_id',teste.id('col_a')),
    'cert.pdf', 'application/pdf', 2048, repeat('d', 64));
  perform public.documento_confirmar_upload(r.versao_id);
  perform set_config('teste.doc_geral', r.documento_id::text, false);
end $$;
select teste.ok((select count(*) from public.documentos) = 1, 'gerente envia e vê documento geral da própria loja');
select teste.ok((select count(*) from public.documento_preparar_upload(null, jsonb_build_object('nome','x','categoria_id',teste.id('cat_geral'),'colaborador_id',teste.id('col_b')), 'x.pdf','application/pdf',10, repeat('e',64))) = 0,
  'gerente de Sorocaba NÃO envia documento para colaborador de Campinas');
select teste.nega($$select public.documento_conferir(current_setting('teste.doc_geral')::uuid, true)$$, 'gerente não aprova documento');

select teste.login('gerente.camp@teste.local', 'aal2');
select teste.ok((select count(*) from public.documentos) = 0, 'gerente de Campinas NÃO vê documentos de Sorocaba');
select teste.ok((select count(*) from public.documento_autorizar_acesso(current_setting('teste.doc_geral')::uuid)) = 0,
  'gerente de Campinas NÃO baixa documento de Sorocaba mesmo sabendo o ID');
select teste.ok((select count(*) from public.documento_versoes) = 0, 'gerente de Campinas não lista caminhos de arquivos de outra loja');

-- ---------------------------------------------------------------------
-- 7. Transferência e máquina de estados
-- ---------------------------------------------------------------------
select teste.login('dp@teste.local', 'aal2');
select teste.nega($$select public.transferir_colaborador(teste.id('col_a'), teste.id('camp'), current_date, 'teste')$$,
  'transferência entre CNPJs diferentes é bloqueada');
select public.transferir_colaborador(teste.id('col_a'), (select id from public.lojas where codigo = 'SOROCABA2'), date '2026-10-01', 'Abertura de nova unidade');
select teste.ok((select count(*) from public.lotacoes where vinculo_id = teste.id('vinc_a')) = 2, 'transferência gera histórico de lotação');

select teste.login('gerente.soro@teste.local', 'aal2');
select teste.ok((select count(*) from public.colaboradores) = 0, 'após transferência, gerente da loja de origem deixa de ver o colaborador');

select teste.login('dp@teste.local', 'aal2');
select teste.nega($$select public.alterar_status_vinculo(teste.id('vinc_a'), 'desligado', 'teste')$$, 'ativo → desligado direto é bloqueado');
select teste.nega($$select public.alterar_status_vinculo(teste.id('vinc_a'), 'em_ferias', '')$$, 'mudança de status exige motivo');
select public.alterar_status_vinculo(teste.id('vinc_a'), 'em_ferias', 'Férias 2026');
select public.alterar_status_vinculo(teste.id('vinc_a'), 'ativo', 'Retorno de férias');
select public.alterar_cargo(teste.id('vinc_a'), (select id from public.cargos where nome = 'Gerente de loja'), date '2026-10-15', 'promocao', 'Promoção');
select teste.ok((select count(*) from public.historico_cargos where vinculo_id = teste.id('vinc_a')) = 2, 'promoção gera histórico de cargos');

do $$ begin
  perform set_config('teste.desl', public.iniciar_desligamento(teste.id('vinc_a'), 'pedido_demissao', date '2026-10-20')::text, false);
end $$;
select teste.ok((select status::text from public.vinculos where id = teste.id('vinc_a')) = 'em_desligamento', 'iniciar desligamento muda status');
select teste.nega($$select public.alterar_status_vinculo(teste.id('vinc_a'), 'desligado', 'pulando processo')$$,
  'desligado sem processo concluído é bloqueado');
select public.concluir_desligamento(current_setting('teste.desl')::uuid, date '2026-10-22');
select teste.ok((select status::text || '|' || data_desligamento::text from public.vinculos where id = teste.id('vinc_a')) = 'desligado|2026-10-22',
  'desligamento concluído registra status e data');
select teste.ok((select count(*) from public.colaboradores where id = teste.id('col_a')) = 1, 'colaborador desligado continua no sistema');
select teste.ok((select count(*) from public.lotacoes where vinculo_id = teste.id('vinc_a') and fim is null) = 0, 'lotação encerrada no desligamento');
select teste.ok((select count(*) from public.eventos_timeline where colaborador_id = teste.id('col_a')) >= 7, 'linha do tempo registra a jornada');

-- ---------------------------------------------------------------------
-- 8. Dashboard e auditoria
-- ---------------------------------------------------------------------
select teste.ok((public.dashboard_resumo() ->> 'colaboradores_ativos')::int = 1, 'dashboard (DP) conta ativos reais');
select teste.login('gerente.camp@teste.local', 'aal2');
select teste.ok((public.dashboard_resumo() ->> 'colaboradores_ativos')::int = 1
            and jsonb_array_length(public.dashboard_resumo() -> 'por_loja') = 1, 'dashboard do gerente só mostra a própria loja');

select teste.login('diretor@teste.local', 'aal1');
select teste.ok((select count(*) from public.audit_log) = 0, 'auditoria exige MFA');
select teste.login('diretor@teste.local', 'aal2');
select teste.ok((select count(*) from public.audit_log where acao = 'LER_DADOS_PESSOAIS' and resultado = 'sucesso') >= 1, 'leitura de dados pessoais fica auditada');
select teste.ok((select count(*) from public.audit_log where resultado = 'negado') >= 5, 'tentativas negadas (dados pessoais, download, upload) ficam auditadas');
select teste.ok((select count(*) from public.audit_log where tabela = 'remuneracoes') >= 2, 'alterações salariais auditadas');
select teste.ok((select count(*) from public.documento_acessos) >= 1, 'downloads de documentos registrados');
select teste.nega($$delete from public.audit_log$$, 'usuário não apaga auditoria');
reset role;
select teste.nega($$update public.audit_log set acao = 'x'$$, 'nem o dono do banco altera auditoria');

-- ---------------------------------------------------------------------
-- 9. Anônimo
-- ---------------------------------------------------------------------
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select teste.nega($$select count(*) from public.colaboradores$$, 'anônimo não acessa colaboradores');
select teste.nega($$select count(*) from public.documentos$$, 'anônimo não acessa documentos');
select teste.nega($$select public.dashboard_resumo()$$, 'anônimo não executa funções');
reset role;

select 'TODOS OS TESTES PASSARAM' as resultado;
rollback;
