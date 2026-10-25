-- Reauditoria: criação de tarefa não forja autoria, datas, origem nem conclusão
begin;
insert into auth.users (email) values ('dir@r94.local'), ('ger@r94.local'), ('rh@r94.local');
select privado.bootstrap_diretoria('dir@r94.local');
update public.usuarios set mfa_obrigatorio = true;
select (select id from public.usuarios where email='dir@r94.local') as dir,
       (select id from public.usuarios where email='ger@r94.local') as ger,
       (select id from public.usuarios where email='rh@r94.local') as rh,
       (select id from public.lojas where codigo='CAMPINAS') as cam \gset
select set_config('teste.dir', :'dir', false), set_config('teste.rh', :'rh', false),
       set_config('teste.ger', :'ger', false), set_config('teste.cam', :'cam', false);
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.conceder_acesso(:'ger','gerente_loja',:'cam');

select set_config('request.jwt.claims', json_build_object('sub',:'ger','aal','aal2')::text, true);
do $$ declare r record; begin
  insert into public.tarefas (titulo, loja_id, status, concluida_por, concluida_em, criado_por, criado_em, chave_dedup)
  values ('Conferir ponto', current_setting('teste.cam')::uuid, 'concluida',
          current_setting('teste.rh')::uuid, '2026-09-01', current_setting('teste.dir')::uuid, '2026-08-25', 'alerta:x')
  returning * into r;
  if r.criado_por <> current_setting('teste.ger')::uuid then raise exception 'FALHOU criado_por forjado na criação'; end if;
  if r.criado_em::date <> current_date then raise exception 'FALHOU criado_em forjado na criação'; end if;
  if r.chave_dedup is not null then raise exception 'FALHOU chave_dedup ocupada na criação'; end if;
  if r.concluida_por <> current_setting('teste.ger')::uuid or r.concluida_em::date <> current_date then
    raise exception 'FALHOU conclusão forjada na criação';
  end if;
  insert into public.tarefas (titulo, loja_id) values ('Aberta', current_setting('teste.cam')::uuid) returning * into r;
  if r.concluida_por is not null or r.origem <> 'manual' then raise exception 'FALHOU tarefa aberta'; end if;
  raise notice 'ok  - criação de tarefa grava autoria, datas e conclusão pelo servidor';
end $$;
reset role;
do $$ begin
  if has_table_privilege('anon', 'public.uniforme_movimentos', 'select') then raise exception 'FALHOU anon com select em uniformes'; end if;
  raise notice 'ok  - anon sem acesso às tabelas de uniformes';
end $$;
select 'REAUDITORIA OK';
rollback;
