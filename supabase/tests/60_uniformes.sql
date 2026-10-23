begin;
insert into auth.users (email) values ('dir@un.local'), ('ger@un.local');
select privado.bootstrap_diretoria('dir@un.local');
select (select id from public.usuarios where email='dir@un.local') as dir, (select id from public.usuarios where email='ger@un.local') as ger \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.conceder_acesso(:'ger','gerente_loja',(select id from public.lojas where codigo='CAMPINAS'));
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Ana Teste','cpf','52998224725','loja_id',(select id from public.lojas where codigo='SOROCABA'),'matricula','1','tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2025-01-01')) as ana \gset
select public.uniforme_item_salvar(null, 'Uniformes', 'Polo Feminino', 'm', 12) as polo \gset
select public.uniforme_item_salvar(null, 'Uniformes', 'Social Feminino', 'G', 10) as social \gset

do $$ begin
  begin perform public.uniforme_item_salvar(null, 'UNIFORMES', 'POLO FEMININO', 'M', 12); raise exception 'FALHOU duplicado';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - peça+tamanho não duplica (e grava em maiúsculas)';
end $$;

select public.uniforme_movimentar('entrada', jsonb_build_array(jsonb_build_object('item_id',:'polo','quantidade',5), jsonb_build_object('item_id',:'social','quantidade',3)), null, current_date, 'saldo inicial');
select public.uniforme_movimentar('saida', jsonb_build_array(jsonb_build_object('item_id',:'polo','quantidade',2)), :'ana', current_date, null);

do $$ declare r record; begin
  select * into r from public.v_uniformes_estoque where peca = 'POLO FEMININO';
  if r.saldo <> 3 or r.a_pedir <> 9 or r.com_colaboradores <> 2 then raise exception 'FALHOU saldo/pedido %', r; end if;
  select * into r from public.v_uniformes_estoque where peca = 'SOCIAL FEMININO';
  if r.saldo <> 3 or r.a_pedir <> 7 then raise exception 'FALHOU mínimo próprio %', r; end if;
  if (select quantidade from public.v_uniformes_posse where peca = 'POLO FEMININO') <> 2 then raise exception 'FALHOU posse'; end if;
  if not exists (select 1 from public.eventos_timeline where tipo = 'uniforme' and titulo = 'UNIFORME ENTREGUE' and descricao like '2 POLO FEMININO M%') then raise exception 'FALHOU timeline'; end if;
  raise notice 'ok  - saldo calculado, a pedir = mínimo − saldo, entrega na ficha do colaborador';
end $$;

do $$ begin
  begin perform public.uniforme_movimentar('saida', jsonb_build_array(jsonb_build_object('item_id',(select id from public.uniforme_itens where peca='POLO FEMININO'),'quantidade',4)), (select id from public.colaboradores where nome_completo='ANA TESTE'), current_date, null);
    raise exception 'FALHOU estoque negativo';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin perform public.uniforme_movimentar('devolucao', jsonb_build_array(jsonb_build_object('item_id',(select id from public.uniforme_itens where peca='POLO FEMININO'),'quantidade',3)), (select id from public.colaboradores where nome_completo='ANA TESTE'), current_date, null);
    raise exception 'FALHOU devolve mais do que tem';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin perform public.uniforme_movimentar('saida', jsonb_build_array(jsonb_build_object('item_id',(select id from public.uniforme_itens where peca='POLO FEMININO'),'quantidade',1)), null, current_date, null);
    raise exception 'FALHOU entrega sem colaborador';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - não deixa estoque negativo, devolução acima da posse nem entrega sem colaborador';
end $$;

select public.uniforme_movimentar('devolucao', jsonb_build_array(jsonb_build_object('item_id',:'polo','quantidade',1)), :'ana', current_date, null);
select public.uniforme_movimentar('ajuste', jsonb_build_array(jsonb_build_object('item_id',:'social','quantidade',1)), null, current_date, 'inventário');
do $$ begin
  if (select saldo from public.v_uniformes_estoque where peca='POLO FEMININO') <> 4 then raise exception 'FALHOU devolução'; end if;
  if (select saldo from public.v_uniformes_estoque where peca='SOCIAL FEMININO') <> 1 then raise exception 'FALHOU ajuste'; end if;
  if (select delta from public.uniforme_movimentos where tipo='ajuste') <> -2 then raise exception 'FALHOU delta do ajuste'; end if;
  raise notice 'ok  - devolução volta ao estoque; inventário lança só a diferença';
end $$;

-- estorno da entrega: Ana já devolveu 1 de 2, então o estorno (−2 da posse) é bloqueado
do $$ declare v uuid := (select id from public.uniforme_movimentos where tipo='saida'); begin
  begin perform public.uniforme_estornar(v, 'erro'); raise exception 'FALHOU estorno com devolução';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  perform public.uniforme_estornar((select id from public.uniforme_movimentos where tipo='devolucao'), 'lançado errado');
  perform public.uniforme_estornar(v, 'lançado errado');
  if (select saldo from public.v_uniformes_estoque where peca='POLO FEMININO') <> 5 then raise exception 'FALHOU saldo pós-estorno'; end if;
  if exists (select 1 from public.v_uniformes_posse) then raise exception 'FALHOU posse pós-estorno'; end if;
  begin perform public.uniforme_estornar(v, 'de novo'); raise exception 'FALHOU estorno duplo';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - estorno desfaz com registro e não pode ser repetido';
end $$;

-- imutável e sem escrita direta
do $$ begin
  begin update public.uniforme_movimentos set quantidade = 99; raise exception 'FALHOU update direto';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin insert into public.uniforme_itens (grupo, peca, tamanho) values ('X','YY','Z'); raise exception 'FALHOU insert direto';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - sem escrita direta nas tabelas';
end $$;

-- gerente de loja não vê nem movimenta o estoque central
select set_config('request.jwt.claims', json_build_object('sub',:'ger','aal','aal2')::text, true);
do $$ begin
  if exists (select 1 from public.v_uniformes_estoque) then raise exception 'FALHOU gerente vê estoque'; end if;
  begin perform public.uniforme_movimentar('entrada', jsonb_build_array(jsonb_build_object('item_id',(select id from public.uniforme_itens limit 1),'quantidade',1)));
    raise exception 'FALHOU gerente movimenta';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - sem permissão não vê nem movimenta';
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.uniforme_itens where peca <> upper(peca) or tamanho <> upper(tamanho))
     or exists (select 1 from public.uniforme_movimentos where observacao <> upper(observacao)) then raise exception 'FALHOU maiúsculas'; end if;
  if (select count(*) from public.audit_log where tabela = 'uniforme_movimentos') < 7 then raise exception 'FALHOU auditoria'; end if;
  raise notice 'ok  - maiúsculas e auditoria';
end $$;
select 'UNIFORMES OK';
rollback;
