-- Documentos vencidos só para o que se renova (categoria com vencimento) e de quem está na empresa
begin;
insert into auth.users (email) values ('dir@a111.local');
select privado.bootstrap_diretoria('dir@a111.local');
update public.usuarios set mfa_obrigatorio = true;
select (select id from public.lojas where codigo='SOROCABA') as sor, (select id from public.usuarios where email='dir@a111.local') as dir \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Ana Ativa','cpf','52998224725','loja_id',:'sor','matricula','1111',
  'tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2024-01-10')) as ana \gset
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Davi Desligado','cpf','11144477735','loja_id',:'sor','matricula','1112',
  'tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2024-01-10')) as davi \gset
reset role;
select set_config('idealize.via_funcao','status',true);
update public.vinculos set status = 'desligado', data_desligamento = current_date - 20 where colaborador_id = :'davi';
select set_config('teste.ana', :'ana', false), set_config('teste.davi', :'davi', false);
do $$
declare aso uuid; guia uuid; ana uuid := current_setting('teste.ana')::uuid; davi uuid := current_setting('teste.davi')::uuid;
begin
  select id into aso from public.doc_categorias where exige_vencimento limit 1;
  select id into guia from public.doc_categorias where not exige_vencimento limit 1;
  if aso is null then insert into public.doc_categorias (codigo, nome, nivel_sigilo, exige_vencimento) values ('aso_teste','ASO TESTE','geral',true) returning id into aso; end if;
  if not privado.doc_exige_renovacao(aso, ana) then raise exception 'FALHOU ASO de ativo deveria renovar'; end if;
  if privado.doc_exige_renovacao(aso, davi) then raise exception 'FALHOU ASO de desligado não renova'; end if;
  if privado.doc_exige_renovacao(guia, ana) then raise exception 'FALHOU guia/atestado não renova'; end if;
  if not privado.doc_exige_renovacao(aso, null) then raise exception 'FALHOU documento da empresa com vencimento renova'; end if;
  if position('doc_exige_renovacao' in pg_get_functiondef('public.painel_pendencias(uuid)'::regprocedure)) = 0 then raise exception 'FALHOU painel sem a regra'; end if;
  raise notice 'ok  - vencidos: só categoria com vencimento e colaborador ainda na empresa';
end $$;
select 'VENCIDOS OK';
