-- Admissão: equipamento/EPI "não tem para entregar"
begin;
insert into auth.users (email) values ('dir@e107.local');
select privado.bootstrap_diretoria('dir@e107.local');
update public.usuarios set mfa_obrigatorio = true;
select (select id from public.usuarios where email='dir@e107.local') as dir, (select id from public.lojas where codigo='SOROCABA') as sor \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Lia Sem Epi','cpf','52998224725','loja_id',:'sor','matricula','1071',
  'tipo','clt_experiencia','status_inicial','ativo','data_admissao',(current_date - 3)::text)) as lia \gset
select set_config('teste.lia', :'lia', false);
do $$ declare id uuid; e jsonb; begin
  select x into e from jsonb_array_elements(public.admissao_checklist(current_setting('teste.lia')::uuid)) x where x->>'item'='equipamento_epi';
  if (e->>'concluido')::boolean then raise exception 'FALHOU EPI já concluído'; end if;
  id := public.admissao_registrar_item(current_setting('teste.lia')::uuid, 'epi_nao_tem', current_date, 'função de vendas');
  select x into e from jsonb_array_elements(public.admissao_checklist(current_setting('teste.lia')::uuid)) x where x->>'item'='equipamento_epi';
  if not (e->>'concluido')::boolean or e->>'detalhe' not like 'NÃO TEM EPI%' or e->>'registro_id' <> id::text then raise exception 'FALHOU não tem: %', e; end if;
  perform public.admissao_cancelar_item(id, 'marcado errado');
  select x into e from jsonb_array_elements(public.admissao_checklist(current_setting('teste.lia')::uuid)) x where x->>'item'='equipamento_epi';
  if (e->>'concluido')::boolean then raise exception 'FALHOU desfazer'; end if;
  raise notice 'ok  - EPI: não tem conclui; desfazer volta a pendente';
end $$;
reset role;
select 'EPI NAO TEM OK';
rollback;
