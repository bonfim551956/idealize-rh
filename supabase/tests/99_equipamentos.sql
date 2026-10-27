-- Equipamentos sob responsabilidade: entrega com termo, devolução, cancelamento e escopo por loja
begin;
insert into auth.users (email) values ('dir@e99.local'), ('ger@e99.local'), ('outro@e99.local');
select privado.bootstrap_diretoria('dir@e99.local');
update public.usuarios set mfa_obrigatorio = true;
select (select id from public.usuarios where email='dir@e99.local') as dir,
       (select id from public.usuarios where email='ger@e99.local') as ger,
       (select id from public.usuarios where email='outro@e99.local') as outro,
       (select id from public.lojas where codigo='SOROCABA') as sor,
       (select id from public.lojas where codigo='CAMPINAS') as cam \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.conceder_acesso(:'ger','gerente_loja',:'sor');
select public.conceder_acesso(:'outro','gerente_loja',:'cam');
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Ana Equip','cpf','52998224725','loja_id',:'sor','matricula','991',
  'tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2026-01-05')) as ana \gset
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Bia Outra','cpf','11144477735','loja_id',:'sor','matricula','992',
  'tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2026-01-05')) as bia \gset
select set_config('teste.ana', :'ana', false), set_config('teste.bia', :'bia', false);

-- gerente da loja entrega com termo
select set_config('request.jwt.claims', json_build_object('sub',:'ger','aal','aal2')::text, true);
select documento_id as termo, versao_id as ver from public.documento_preparar_upload(null,
  jsonb_build_object('nome','Termo equipamentos','categoria_id',(select id from public.doc_categorias where codigo='termo_equipamento'),
                     'colaborador_id',:'ana'),
  'termo.pdf','application/pdf',1024, repeat('a',64)) \gset
reset role;
insert into storage.objects (bucket_id, name) select 'documentos', storage_path from public.documento_versoes where id = :'ver';
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'ger','aal','aal2')::text, true);
select public.documento_confirmar_upload(:'ver');
select set_config('teste.termo', :'termo', false);
select public.equipamento_entregar(:'ana', '2026-10-20',
  '[{"tipo":"Celular","descricao":"Samsung A15","identificacao":"IMEI 123"},{"tipo":"Chip","identificacao":"(15) 99999-0000"}]', :'termo', 'kit loja');
do $$ declare n int; begin
  select count(*) into n from public.equipamentos where colaborador_id = current_setting('teste.ana')::uuid and documento_id = current_setting('teste.termo')::uuid;
  if n <> 2 then raise exception 'FALHOU entrega com termo: %', n; end if;
  if not exists (select 1 from public.equipamentos where tipo = 'CELULAR' and descricao = 'SAMSUNG A15') then raise exception 'FALHOU maiúsculas'; end if;
  -- termo de outro colaborador não pode ser usado
  begin perform public.equipamento_entregar(current_setting('teste.bia')::uuid, '2026-10-20', '[{"tipo":"Tablet"}]', current_setting('teste.termo')::uuid);
    raise exception 'FALHOU aceitou termo de outra pessoa';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin update public.equipamentos set devolvido_em = current_date; raise exception 'FALHOU alterou direto';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - entrega com termo do próprio colaborador; sem alteração direta';
end $$;

-- devolução e cancelamento
do $$ declare e uuid; c uuid; begin
  select id into e from public.equipamentos where tipo = 'CELULAR';
  select id into c from public.equipamentos where tipo = 'CHIP';
  begin perform public.equipamento_devolver(e, '2026-10-25', 'danificado', null); raise exception 'FALHOU dano sem descrição';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  perform public.equipamento_devolver(e, '2026-10-25', 'danificado', 'tela trincada');
  perform public.equipamento_cancelar(c, 'lançado em duplicidade');
  if (select devolucao_estado from public.equipamentos where id = e) <> 'danificado' or not (select cancelado from public.equipamentos where id = c) then
    raise exception 'FALHOU devolução/cancelamento'; end if;
  raise notice 'ok  - devolução com estado e cancelamento com motivo';
end $$;

-- gerente de outra loja não vê nem registra
select set_config('request.jwt.claims', json_build_object('sub',:'outro','aal','aal2')::text, true);
do $$ begin
  if exists (select 1 from public.equipamentos) then raise exception 'FALHOU outra loja vê equipamentos'; end if;
  begin perform public.equipamento_entregar(current_setting('teste.ana')::uuid, current_date, '[{"tipo":"Notebook"}]');
    raise exception 'FALHOU outra loja registrou';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - escopo por loja';
end $$;
reset role;
select 'EQUIPAMENTOS OK';
rollback;
