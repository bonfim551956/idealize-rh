begin;
insert into auth.users (email) values ('dir@tar.local'), ('resp@tar.local');
select privado.bootstrap_diretoria('dir@tar.local');
select (select id from public.usuarios where email='dir@tar.local') as dir, (select id from public.usuarios where email='resp@tar.local') as resp \gset
select (select id from public.lojas where codigo='CAMPINAS') as cam, (select id from public.lojas where codigo='SOROCABA') as sor \gset
select set_config('teste.sor', :'sor', false), set_config('teste.dir', :'dir', false), set_config('teste.resp', :'resp', false);
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
insert into public.tarefas (titulo, loja_id, responsavel_id) values ('Conferir ponto', :'cam', :'resp') returning id as tarefa \gset
select set_config('teste.tarefa', :'tarefa', false);

-- responsável sem tarefa.gerir
select set_config('request.jwt.claims', json_build_object('sub',:'resp','aal','aal2')::text, true);
do $$ declare t uuid := current_setting('teste.tarefa')::uuid; begin
  begin update public.tarefas set loja_id = current_setting('teste.sor')::uuid, titulo = 'Falso' where id = t;
    raise exception 'FALHOU responsável move tarefa de loja';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin update public.tarefas set origem = 'sistema' where id = t;
    raise exception 'FALHOU responsável forja origem';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin update public.tarefas set chave_dedup = 'alerta:x' where id = t;
    raise exception 'FALHOU responsável ocupa chave_dedup';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin update public.tarefas set criado_por = current_setting('teste.resp')::uuid where id = t;
    raise exception 'FALHOU responsável forja criado_por';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin update public.tarefas set titulo = 'Outro' where id = t;
    raise exception 'FALHOU responsável troca título';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - responsável não muda loja, origem, chave, autoria nem título';
end $$;

do $$ declare t uuid := current_setting('teste.tarefa')::uuid; r record; begin
  update public.tarefas set status = 'em_andamento', descricao = 'iniciado' where id = t;
  update public.tarefas set status = 'concluida', concluida_em = '2000-01-01',
         concluida_por = current_setting('teste.dir')::uuid where id = t;
  select * into r from public.tarefas where id = t;
  if r.status <> 'concluida' then raise exception 'FALHOU responsável não conclui'; end if;
  if r.concluida_por <> current_setting('teste.resp')::uuid then raise exception 'FALHOU concluida_por forjado'; end if;
  if r.concluida_em::date <> current_date then raise exception 'FALHOU concluida_em forjado'; end if;
  if r.loja_id = current_setting('teste.sor')::uuid then raise exception 'FALHOU loja trocada'; end if;
  raise notice 'ok  - responsável altera status/descrição e a conclusão é gravada pelo servidor';
end $$;

-- gestor com tarefa.gerir nas duas lojas pode mover, mas não forja origem
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
do $$ declare t uuid := current_setting('teste.tarefa')::uuid; begin
  update public.tarefas set loja_id = current_setting('teste.sor')::uuid where id = t;
  if (select loja_id from public.tarefas where id = t) <> current_setting('teste.sor')::uuid then raise exception 'FALHOU gestor move'; end if;
  begin update public.tarefas set origem = 'sistema' where id = t;
    raise exception 'FALHOU gestor forja origem';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - gestor move tarefa entre lojas que gere, sem forjar origem';
end $$;
reset role;
select 'TAREFAS OK';
rollback;
