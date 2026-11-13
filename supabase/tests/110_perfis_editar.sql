-- Editar perfis e permissões
begin;
insert into auth.users (email) values ('dir@a110.local'), ('rh@a110.local');
select privado.bootstrap_diretoria('dir@a110.local');
update public.usuarios set mfa_obrigatorio = true;
select (select id from public.usuarios where email='dir@a110.local') as dir, (select id from public.usuarios where email='rh@a110.local') as rh \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.conceder_acesso(:'rh','gerente_loja',(select id from public.lojas where codigo='SOROCABA'));
do $$ declare dp uuid; dir uuid; novo uuid; r jsonb; extra text; begin
  select id into dp from public.perfis where codigo = 'departamento_pessoal';
  select id into dir from public.perfis where codigo = 'diretoria';
  select codigo into extra from public.permissoes where codigo not in (select permissao from public.perfil_permissoes where perfil_id = dp) order by codigo limit 1;
  -- diretoria não altera o próprio perfil
  begin perform public.perfil_permissoes_definir(dir, array['dashboard.ver'], 'teste'); raise exception 'FALHOU alterou o próprio';
  exception when insufficient_privilege then null; when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin perform public.perfil_permissoes_definir(dp, array['dashboard.ver'], ' '); raise exception 'FALHOU sem motivo';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin perform public.perfil_permissoes_definir(dp, array['inexistente.x'], 'teste'); raise exception 'FALHOU permissão inventada';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  r := public.perfil_permissoes_definir(dp, (select array_agg(permissao) from public.perfil_permissoes where perfil_id = dp and permissao <> 'vt.gerir') || array[extra], 'ajuste de teste');
  if not (r->'retiradas' ? 'vt.gerir') or not (r->'incluidas' ? extra) then raise exception 'FALHOU diff: %', r; end if;
  if exists (select 1 from public.perfil_permissoes where perfil_id = dp and permissao = 'vt.gerir') then raise exception 'FALHOU não retirou'; end if;
  if not exists (select 1 from public.audit_log where acao = 'PERFIL_PERMISSOES' and registro_id = dp::text and contexto->>'motivo' = 'ajuste de teste') then raise exception 'FALHOU auditoria'; end if;
  novo := public.perfil_salvar(null, 'Óptico Técnico', 'Atende laboratório', dp);
  if (select codigo from public.perfis where id = novo) <> 'optico_tecnico' then raise exception 'FALHOU código'; end if;
  if (select count(*) from public.perfil_permissoes where perfil_id = novo) <> (select count(*) from public.perfil_permissoes where perfil_id = dp) then raise exception 'FALHOU cópia'; end if;
  begin perform public.perfil_salvar(null, 'optico tecnico', null); raise exception 'FALHOU nome duplicado';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  perform public.perfil_salvar(dp, 'OUTRO NOME', 'Nova descrição');
  if (select nome from public.perfis where id = dp) <> 'DEPARTAMENTO PESSOAL' then raise exception 'FALHOU renomeou perfil do sistema'; end if;
  raise notice 'ok  - edita permissões com motivo, audita, cria perfil copiando e protege o próprio perfil';
end $$;
select set_config('request.jwt.claims', json_build_object('sub',:'rh','aal','aal2')::text, true);
do $$ begin
  begin perform public.perfil_permissoes_definir((select id from public.perfis where codigo='gerente_loja'), array[]::text[], 'x');
    raise exception 'FALHOU gerente editou perfil';
  exception when insufficient_privilege then null; when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - sem gerenciar acessos não edita';
end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
do $$ declare a uuid; n uuid; u uuid; begin
  select id into u from public.usuarios where email = 'rh@a110.local';
  select id into a from public.usuario_atribuicoes where usuario_id = u and ativo;
  n := public.trocar_acesso(a, 'supervisor', null, null, 'promovido a supervisor');
  if (select count(*) from public.usuario_atribuicoes where usuario_id = u and ativo) <> 1
     or (select p.codigo from public.usuario_atribuicoes x join public.perfis p on p.id = x.perfil_id where x.id = n) <> 'supervisor' then raise exception 'FALHOU troca'; end if;
  begin perform public.trocar_acesso(n, 'gerente_loja', null, null, 'sem loja'); raise exception 'FALHOU gerente sem loja';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  if not exists (select 1 from public.usuario_atribuicoes where id = n and ativo) then raise exception 'FALHOU não desfez a troca com erro'; end if;
  begin perform public.trocar_acesso((select id from public.usuario_atribuicoes where usuario_id = auth.uid() and ativo limit 1), 'supervisor', null, null, 'x');
    raise exception 'FALHOU trocou o próprio';
  exception when insufficient_privilege then null; when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - troca o perfil da pessoa num passo, tudo ou nada, e não troca o próprio';
end $$;
reset role;
select 'PERFIS OK';
