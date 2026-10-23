-- Views da interface respeitam RLS e privilégios de coluna
begin;
insert into auth.users (email) values ('d@v.local'),('g@v.local');
select privado.bootstrap_diretoria('d@v.local');
select (select id from public.usuarios where email='d@v.local') as dir, (select id from public.usuarios where email='g@v.local') as ger \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.conceder_acesso(:'ger','gerente_loja',(select id from public.lojas where codigo='CAMPINAS'));
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Ana','cpf','52998224725','loja_id',(select id from public.lojas where codigo='SOROCABA'),'matricula','1','tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2025-01-01'));
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Bia','cpf','11144477735','loja_id',(select id from public.lojas where codigo='CAMPINAS'),'matricula','2','tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2025-01-01'));
do $$ begin if (select count(*) from public.v_colaboradores) <> 2 then raise exception 'FALHOU diretoria vê 2'; end if; raise notice 'ok  - nome automático com e-mail curto (d@v.local) não quebra o cadastro'; end $$;
select set_config('request.jwt.claims', json_build_object('sub',:'ger','aal','aal2')::text, true);
do $$ begin
  if (select count(*) from public.v_colaboradores) <> 1 then raise exception 'FALHOU gerente vê só 1 na view'; end if;
  if (select loja_codigo from public.v_colaboradores) <> 'CAMPINAS' then raise exception 'FALHOU loja errada'; end if;
  if (select status::text from public.v_colaboradores) <> 'ativo' then raise exception 'FALHOU status'; end if;
  raise notice 'ok  - views respeitam isolamento por loja';
end $$;
reset role;
set role anon;
do $$ begin
  begin perform 1 from public.v_colaboradores; raise exception 'FALHOU anon leu view'; exception when insufficient_privilege then raise notice 'ok  - anônimo bloqueado na view'; end;
end $$;
reset role;
select 'VIEWS OK';
rollback;
