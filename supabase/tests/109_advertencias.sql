-- Advertências
begin;
insert into auth.users (email) values ('dir@a109.local'), ('ger@a109.local');
select privado.bootstrap_diretoria('dir@a109.local');
update public.usuarios set mfa_obrigatorio = true;
select (select id from public.usuarios where email='dir@a109.local') as dir, (select id from public.usuarios where email='ger@a109.local') as ger,
       (select id from public.lojas where codigo='SOROCABA') as sor \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.conceder_acesso(:'ger','gerente_loja',:'sor');
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Rui Advertido','cpf','52998224725','loja_id',:'sor','matricula','1091',
  'tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2024-01-10')) as rui \gset
select set_config('teste.rui', :'rui', false);
do $$ declare id1 uuid; id2 uuid; r jsonb; m uuid; begin
  select id into m from public.advertencia_motivos where nome = 'ATRASO';
  id1 := public.advertencia_registrar(jsonb_build_object('colaborador_id', current_setting('teste.rui'), 'tipo','escrita',
    'data_ocorrencia', current_date - 20, 'data_aplicacao', current_date - 20, 'motivo_id', m, 'descricao','Chegou 1h atrasado sem aviso prévio.'));
  id2 := public.advertencia_registrar(jsonb_build_object('colaborador_id', current_setting('teste.rui'), 'tipo','suspensao','dias_suspensao',2,
    'data_ocorrencia', current_date - 5, 'motivo_texto','Reincidência de atraso', 'descricao','Novo atraso de 1h20 sem justificativa.'));
  begin perform public.advertencia_registrar(jsonb_build_object('colaborador_id', current_setting('teste.rui'), 'tipo','suspensao','dias_suspensao',40,
      'data_ocorrencia', current_date, 'motivo_texto','X X X', 'descricao','descrição longa o bastante'));
    raise exception 'FALHOU aceitou 40 dias';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  r := public.advertencias_listar(null, current_setting('teste.rui')::uuid);
  if jsonb_array_length(r) <> 2 or (r->0->>'anteriores_90d')::int <> 1 or r->0->>'motivo' <> 'REINCIDÊNCIA DE ATRASO' then raise exception 'FALHOU lista: %', r; end if;
  if not exists (select 1 from jsonb_array_elements(public.painel_pendencias(null)->'pendencias') x where x->>'chave' = 'advertencias_assinatura')
    then raise exception 'FALHOU painel'; end if;
  perform public.advertencia_cancelar(id1, 'lançada em duplicidade');
  if jsonb_array_length(public.advertencias_listar(null, null)) <> 1 then raise exception 'FALHOU cancelar'; end if;
  perform public.advertencia_motivo_salvar(null, 'Teste de motivo', true);
  raise notice 'ok  - registra, lista com reincidência, painel, cancela e motivos';
end $$;
select set_config('request.jwt.claims', json_build_object('sub',:'ger','aal','aal2')::text, true);
do $$ begin
  begin perform public.advertencias_listar(null, null); raise exception 'FALHOU gerente leu advertências';
  exception when insufficient_privilege then null; when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - gerente sem acesso disciplinar não vê';
end $$;
reset role;
select 'ADVERTENCIAS OK';
rollback;
