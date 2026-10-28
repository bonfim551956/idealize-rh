begin;
insert into auth.users (email) values ('dir@f100.local'), ('ger@f100.local');
select privado.bootstrap_diretoria('dir@f100.local');
update public.usuarios set mfa_obrigatorio = true;
select (select id from public.usuarios where email='dir@f100.local') as dir,
       (select id from public.usuarios where email='ger@f100.local') as ger,
       (select id from public.lojas where codigo='SOROCABA') as sor \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.conceder_acesso(:'ger','gerente_loja',:'sor');
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Ana Exp','cpf','52998224725','loja_id',:'sor','matricula','1001',
  'tipo','clt_experiencia','status_inicial','ativo','data_admissao',(current_date - 40)::text)) as ana \gset
select vinculo_id as vin from public.v_colaboradores where id = :'ana' \gset
select set_config('teste.vin', :'vin', false);
select set_config('request.jwt.claims', json_build_object('sub',:'ger','aal','aal2')::text, true);
do $$ begin
  begin perform public.efetivar_contrato(current_setting('teste.vin')::uuid, current_date); raise exception 'FALHOU gerente efetivou';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - sem colaborador.editar não efetiva';
end $$;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.efetivar_contrato(:'vin', current_date - 9, 'continua na equipe');
do $$ begin
  if (select tipo::text from public.vinculos where id = current_setting('teste.vin')::uuid) <> 'clt_prazo_indeterminado' then raise exception 'FALHOU efetivação'; end if;
  if (select jsonb_array_length(public.painel_avisos()->'experiencia')) <> 0 then raise exception 'FALHOU aviso continua'; end if;
  begin perform public.efetivar_contrato(current_setting('teste.vin')::uuid, current_date); raise exception 'FALHOU efetivou duas vezes';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - efetivado, sai do aviso, não repete';
end $$;
reset role;
select 'EFETIVAR OK';
rollback;
