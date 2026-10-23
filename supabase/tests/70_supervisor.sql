begin;
insert into auth.users (email) values ('dir@sup.local'), ('sup@sup.local');
select privado.bootstrap_diretoria('dir@sup.local');
select (select id from public.usuarios where email='dir@sup.local') as dir, (select id from public.usuarios where email='sup@sup.local') as sup \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.conceder_acesso(:'sup','supervisor',(select id from public.lojas where codigo='SOROCABA'));
select public.conceder_acesso(:'sup','supervisor',(select id from public.lojas where codigo='CAMPINAS'));
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Sor','cpf','52998224725','loja_id',(select id from public.lojas where codigo='SOROCABA'),'matricula','1','tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2025-01-01','salario_base','2000')) as sor \gset
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Pira','cpf','11144477735','loja_id',(select id from public.lojas where codigo='PIRACICABA'),'matricula','2','tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2025-01-01')) as pira \gset
select public.uniforme_item_salvar(null,'UNIFORMES','POLO','M',12) as polo \gset
select public.uniforme_movimentar('entrada', jsonb_build_array(jsonb_build_object('item_id',:'polo','quantidade',10)));
select public.uniforme_movimentar('saida', jsonb_build_array(jsonb_build_object('item_id',:'polo','quantidade',3)), :'pira');

select set_config('request.jwt.claims', json_build_object('sub',:'sup','aal','aal2')::text, true);
select public.uniforme_movimentar('saida', jsonb_build_array(jsonb_build_object('item_id',:'polo','quantidade',2)), :'sor');
do $$ declare r record; begin
  if (select count(*) from public.v_colaboradores) <> 1 then raise exception 'FALHOU escopo colaboradores'; end if;
  if not exists (select 1 from public.remuneracoes) then raise exception 'FALHOU supervisor vê salário'; end if;
  select * into r from public.v_uniformes_estoque;
  if r.saldo <> 5 or r.com_colaboradores <> 5 or r.a_pedir <> 7 then raise exception 'FALHOU estoque central para supervisor %', r; end if;
  if (select count(*) from public.v_uniformes_movimentos) <> 1 then raise exception 'FALHOU supervisor vê movimentos de fora'; end if;
  if (select count(*) from public.v_uniformes_posse) <> 1 then raise exception 'FALHOU posse escopo'; end if;
  raise notice 'ok  - supervisor vê só suas lojas, salário e o estoque central correto';
end $$;
do $$ begin
  begin perform public.uniforme_movimentar('saida', jsonb_build_array(jsonb_build_object('item_id',(select id from public.uniforme_itens limit 1),'quantidade',1)), (select id from public.colaboradores where nome_completo='PIRA'));
    raise exception 'FALHOU entrega fora da loja';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin perform public.uniforme_movimentar('entrada', jsonb_build_array(jsonb_build_object('item_id',(select id from public.uniforme_itens limit 1),'quantidade',1)));
    raise exception 'FALHOU supervisor dá entrada';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin perform public.uniforme_estornar((select id from public.uniforme_movimentos limit 1), 'x');
    raise exception 'FALHOU supervisor estorna';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin perform public.registrar_remuneracao((select vinculo_id from public.v_colaboradores limit 1), 3000, current_date, 'x');
    raise exception 'FALHOU supervisor altera salário';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - supervisor não entrega fora das suas lojas, não dá entrada/estorno nem altera salário';
end $$;
select set_config('request.jwt.claims', json_build_object('sub',:'sup','aal','aal1')::text, true);
do $$ begin
  if exists (select 1 from public.remuneracoes) then raise exception 'FALHOU salário sem MFA'; end if;
  raise notice 'ok  - salário só com verificação em duas etapas';
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.conceder_acesso(:'sup','supervisor',null);
select set_config('request.jwt.claims', json_build_object('sub',:'sup','aal','aal2')::text, true);
do $$ begin
  if (select count(*) from public.v_colaboradores) <> 2 then raise exception 'FALHOU supervisor todas as lojas'; end if;
  perform public.uniforme_movimentar('saida', jsonb_build_array(jsonb_build_object('item_id',(select id from public.uniforme_itens limit 1),'quantidade',1)), (select id from public.colaboradores where nome_completo='PIRA'));
  begin perform public.uniforme_movimentar('entrada', jsonb_build_array(jsonb_build_object('item_id',(select id from public.uniforme_itens limit 1),'quantidade',1)));
    raise exception 'FALHOU supervisor global dá entrada';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin perform public.uniforme_estornar((select id from public.uniforme_movimentos limit 1), 'x');
    raise exception 'FALHOU supervisor global estorna';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - supervisor de todas as lojas entrega em qualquer loja, mas não controla o estoque central';
end $$;
reset role;
select 'SUPERVISOR OK';
rollback;
