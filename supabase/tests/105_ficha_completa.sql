-- Ficha completa (Registro de Empregado)
begin;
insert into auth.users (email) values ('dir@f105.local'), ('ger@f105.local');
select privado.bootstrap_diretoria('dir@f105.local');
update public.usuarios set mfa_obrigatorio = true;
select (select id from public.usuarios where email='dir@f105.local') as dir,
       (select id from public.usuarios where email='ger@f105.local') as ger,
       (select id from public.lojas where codigo='SOROCABA') as sor \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.conceder_acesso(:'ger','gerente_loja',:'sor');
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Rita Ficha','cpf','52998224725','loja_id',:'sor','matricula','1051',
  'tipo','clt_experiencia','status_inicial','ativo','data_admissao','2026-11-03')) as rita \gset
select set_config('teste.rita', :'rita', false);
select public.colaborador_ficha_salvar(:'rita', 'contrato', '{"funcao":"vendas","cbo":"521110","horario_intervalo":"12:00 às 13:10","fgts_opcao":"2026-11-03","escala":"09:00 às 18:00","jornada_semanal_horas":"44"}');
select public.colaborador_ficha_salvar(:'rita', 'pessoais', '{"nome_mae":"Maria","estado_civil":"solteira","data_nascimento":"1998-04-12"}');
select public.colaborador_ficha_salvar(:'rita', 'documentos', '{"rg":"12.345.678-9","pis":"123.45678.90-1","rg_emissao":"2015-01-27"}');
select public.colaborador_ficha_salvar(:'rita', 'contato', '{"telefone_residencial":"1532221111","cidade":"Sorocaba","uf":"sp"}');
select public.colaborador_ficha_salvar(:'rita', 'banco', '{"banco":"341 itau","agencia":"1234","conta":"56789-0"}');
select public.colaborador_ficha_salvar(:'rita', 'dependentes', '{"dependentes":[{"nome":"Lucas","parentesco":"filho","data_nascimento":"2019-08-02"}]}');
do $$ declare r jsonb := public.colaborador_ficha(current_setting('teste.rita')::uuid, true); begin
  if r->>'nome_mae' <> 'MARIA' or r->>'rg' <> '12.345.678-9' or r->>'banco' <> '341 ITAU' or r->>'uf' <> 'SP'
     or r->>'fim_experiencia_1' <> '2026-11-17' or r->>'cbo' <> '521110' or jsonb_array_length(r->'dependentes') <> 1
     or (r->>'completo')::boolean is not true then raise exception 'FALHOU leitura completa: %', r; end if;
  if (select escala from public.vinculos where colaborador_id = current_setting('teste.rita')::uuid) <> '09:00 ÀS 18:00' then raise exception 'FALHOU escala'; end if;
  perform public.colaborador_ficha_salvar(current_setting('teste.rita')::uuid, 'banco', '{"conta":""}');
  if public.colaborador_ficha(current_setting('teste.rita')::uuid, true)->>'conta' is not null then raise exception 'FALHOU limpar campo'; end if;
  raise notice 'ok  - salva e lê todos os blocos; campo vazio limpa';
end $$;
select set_config('request.jwt.claims', json_build_object('sub',:'ger','aal','aal2')::text, true);
do $$ declare r jsonb := public.colaborador_ficha(current_setting('teste.rita')::uuid, true); begin
  if (r->>'completo')::boolean or r ? 'rg' or r ? 'cpf' then raise exception 'FALHOU gerente viu dados pessoais: %', r; end if;
  if r->>'cbo' <> '521110' then raise exception 'FALHOU gerente deve ver contrato'; end if;
  begin perform public.colaborador_ficha_salvar(current_setting('teste.rita')::uuid, 'banco', '{"conta":"1"}'); raise exception 'FALHOU gerente editou banco';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin perform 1 from public.colaborador_ficha limit 1; raise exception 'FALHOU leitura direta';
  exception when insufficient_privilege then null; end;
  raise notice 'ok  - gerente só vê o contrato; sem leitura direta da tabela';
end $$;
reset role;
select 'FICHA COMPLETA OK';
rollback;
