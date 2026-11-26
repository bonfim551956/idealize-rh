-- Desligado sai de VT, banco de horas, advertências gerais e pendências; aparece em Desligados
begin;
insert into auth.users (email) values ('dir@a112.local');
select privado.bootstrap_diretoria('dir@a112.local');
update public.usuarios set mfa_obrigatorio = true;
select (select id from public.lojas where codigo='SOROCABA') as sor, (select id from public.usuarios where email='dir@a112.local') as dir \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Ana Fica','cpf','52998224725','loja_id',:'sor','matricula','1121',
  'tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2024-01-10')) as ana \gset
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Davi Sai','cpf','11144477735','loja_id',:'sor','matricula','1122',
  'tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2024-01-10')) as davi \gset
select public.vt_salvar(:'ana', true, 10), public.vt_salvar(:'davi', true, 10);
select public.advertencia_registrar(jsonb_build_object('colaborador_id', :'davi', 'tipo','escrita','data_ocorrencia', current_date - 3,
  'motivo_texto','ATRASO','descricao','Chegou atrasado sem aviso prévio.'));
reset role;
select set_config('idealize.via_funcao','status',true);
update public.vinculos set status = 'desligado', data_desligamento = current_date - 2 where colaborador_id = :'davi';
select set_config('idealize.via_funcao','',true);
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select set_config('teste.ana', :'ana', true), set_config('teste.davi', :'davi', true);
do $$ declare ana uuid := current_setting('teste.ana')::uuid; davi uuid := current_setting('teste.davi')::uuid; begin
  if exists (select 1 from public.vt_calculo(date_trunc('month', current_date)::date, null) where colaborador_id = davi) then raise exception 'FALHOU desligado no VT'; end if;
  if not exists (select 1 from public.vt_calculo(date_trunc('month', current_date)::date, null) where colaborador_id = ana) then raise exception 'FALHOU ativo sumiu do VT'; end if;
  if exists (select 1 from jsonb_array_elements(public.advertencias_listar(null, null)) x where (x->>'colaborador_id')::uuid = davi) then raise exception 'FALHOU desligado na lista de advertências'; end if;
  if jsonb_array_length(public.advertencias_listar(null, davi)) <> 1 then raise exception 'FALHOU ficha perdeu a advertência'; end if;
  if not exists (select 1 from jsonb_array_elements(public.desligados_listar(null)) x where (x->>'colaborador_id')::uuid = davi) then raise exception 'FALHOU não está em Desligados'; end if;
  if exists (select 1 from jsonb_array_elements(public.desligados_listar(null)) x where (x->>'colaborador_id')::uuid = ana) then raise exception 'FALHOU ativo em Desligados'; end if;
  perform public.painel_pendencias(null); perform public.banco_horas_resumo(null);
  raise notice 'ok  - desligado fora de VT/advertências/pendências e listado em Desligados';
end $$;
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Caio Novo','cpf','39053344705','loja_id',:'sor','matricula','1123',
  'tipo','clt_prazo_indeterminado','status_inicial','pre_admissao','data_admissao', current_date + 10)) as caio \gset
select set_config('teste.caio', :'caio', true);
do $$ begin
  if (select status from public.vinculos where colaborador_id = current_setting('teste.caio')::uuid) <> 'em_admissao' then raise exception 'FALHOU pré-admissão não virou em admissão'; end if;
  if exists (select 1 from public.status_transicoes where para = 'pre_admissao') then raise exception 'FALHOU transição para pré-admissão'; end if;
  raise notice 'ok  - pré-admissão extinta: cadastro nasce em admissão';
end $$;
reset role;
select 'DESLIGADOS OK';
