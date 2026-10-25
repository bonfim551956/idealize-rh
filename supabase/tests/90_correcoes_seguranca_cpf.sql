begin;
insert into auth.users (email) values ('dir@cpf.local'), ('ger@cpf.local');
select privado.bootstrap_diretoria('dir@cpf.local');
update public.usuarios set mfa_obrigatorio = true;
select (select id from public.usuarios where email='dir@cpf.local') as dir, (select id from public.usuarios where email='ger@cpf.local') as ger \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.conceder_acesso(:'ger','gerente_loja',(select id from public.lojas where codigo='SOROCABA'));
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Ana','cpf','52998224725','loja_id',(select id from public.lojas where codigo='SOROCABA'),'matricula','1','tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2025-01-01'));
do $$ begin
  if (select count(*) from public.localizar_colaborador_por_cpf('529.982.247-25')) <> 1 then raise exception 'FALHOU diretoria com MFA acha por CPF'; end if;
  raise notice 'ok  - diretoria com MFA localiza por CPF';
end $$;

-- gerente da MESMA loja: vê o colaborador e o CPF mascarado, mas não pode usar a busca como oráculo
select set_config('request.jwt.claims', json_build_object('sub',:'ger','aal','aal2')::text, true);
do $$ begin
  if not exists (select 1 from public.v_colaboradores where cpf_mascarado = '***.982.247-**') then raise exception 'FALHOU gerente deveria ver o colaborador mascarado'; end if;
  if (select count(*) from public.localizar_colaborador_por_cpf('52998224725')) <> 0 then raise exception 'FALHOU gerente sem dados pessoais confirmou CPF completo'; end if;
  raise notice 'ok  - gerente sem dados_pessoais.ler não confirma CPF completo';
end $$;

-- sem MFA a diretoria também não localiza (mesma regra de colaborador_dados_pessoais)
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal1')::text, true);
do $$ begin
  if (select count(*) from public.localizar_colaborador_por_cpf('52998224725')) <> 0 then raise exception 'FALHOU busca por CPF sem MFA'; end if;
  raise notice 'ok  - busca por CPF exige MFA';
end $$;
reset role;

do $$ begin
  if (select count(*) from public.audit_log where acao = 'LOCALIZAR_POR_CPF') <> 3 then raise exception 'FALHOU cada busca por CPF auditada'; end if;
  if (select count(*) from public.audit_log where acao = 'LOCALIZAR_POR_CPF' and resultado = 'sucesso' and registro_id is not null) <> 1 then raise exception 'FALHOU auditoria do acerto'; end if;
  if (select count(*) from public.audit_log where acao = 'LOCALIZAR_POR_CPF' and resultado = 'negado') <> 2 then raise exception 'FALHOU auditoria das negadas'; end if;
  if exists (select 1 from public.audit_log where acao = 'LOCALIZAR_POR_CPF' and coalesce(contexto::text, '') like '%52998224725%') then raise exception 'FALHOU CPF gravado na auditoria'; end if;
  raise notice 'ok  - buscas por CPF auditadas sem gravar o CPF';
end $$;
select 'CORRECOES CPF OK';
rollback;
