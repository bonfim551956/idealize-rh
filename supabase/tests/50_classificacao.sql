begin;
insert into auth.users (email) values ('dir@ia.local'), ('ger@ia.local');
select privado.bootstrap_diretoria('dir@ia.local');
select (select id from public.usuarios where email='dir@ia.local') as dir, (select id from public.usuarios where email='ger@ia.local') as ger \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.conceder_acesso(:'ger','gerente_loja',(select id from public.lojas where codigo='CAMPINAS'));
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Ana','cpf','52998224725','loja_id',(select id from public.lojas where codigo='SOROCABA'),'matricula','1','tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2025-01-01'));
do $$ begin
  if (select count(*) from public.localizar_colaborador_por_cpf('529.982.247-25')) <> 1 then raise exception 'FALHOU diretoria acha por CPF'; end if;
end $$;
select public.registrar_sugestao_ia('{"arquivo":"aso.pdf","categoria_sugerida":"exames_ocupacionais","confianca":"alta","colaborador_encontrado":true,"modelo":"x"}');
select set_config('request.jwt.claims', json_build_object('sub',:'ger','aal','aal2')::text, true);
do $$ begin
  if (select count(*) from public.localizar_colaborador_por_cpf('52998224725')) <> 0 then raise exception 'FALHOU gerente de outra loja achou por CPF'; end if;
  raise notice 'ok  - busca por CPF respeita o acesso por loja';
end $$;
reset role;
do $$ begin
  if (select count(*) from public.audit_log where acao = 'CLASSIFICACAO_IA') <> 1 then raise exception 'FALHOU auditoria IA'; end if;
  if exists (select 1 from public.doc_categorias where dica_ia is null or dica_ia <> upper(dica_ia)) then raise exception 'FALHOU dicas'; end if;
  raise notice 'ok  - sugestões da IA auditadas e dicas configuradas em maiúsculas';
end $$;
select 'CLASSIFICACAO OK';
rollback;
