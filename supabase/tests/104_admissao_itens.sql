-- Itens obrigatórios da admissão
begin;
insert into auth.users (email) values ('dir@a104.local'), ('ger@a104.local');
select privado.bootstrap_diretoria('dir@a104.local');
update public.usuarios set mfa_obrigatorio = true;
select (select id from public.usuarios where email='dir@a104.local') as dir,
       (select id from public.usuarios where email='ger@a104.local') as ger,
       (select id from public.lojas where codigo='SOROCABA') as sor,
       (select id from public.lojas where codigo='CAMPINAS') as cps \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.conceder_acesso(:'ger','gerente_loja',:'sor');
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Julia Admissao','cpf','52998224725','loja_id',:'sor','matricula','1041',
  'tipo','clt_experiencia','status_inicial','ativo','data_admissao',(current_date - 3)::text)) as ju \gset
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Caio Outra Loja','cpf','11144477735','loja_id',:'cps','matricula','1042',
  'tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2025-01-10')) as caio \gset
select set_config('teste.ju', :'ju', false);
do $$ declare j jsonb := public.admissao_checklist(current_setting('teste.ju')::uuid); p jsonb; begin
  if jsonb_array_length(j) <> 5 or exists (select 1 from jsonb_array_elements(j) x where (x->>'concluido')::boolean) then raise exception 'FALHOU checklist inicial: %', j; end if;
  select x into p from jsonb_array_elements(public.painel_pendencias()->'pendencias') x where x->>'chave' = 'admissao_itens';
  if p is null or (p->>'quantidade')::int <> 2 or p->>'gravidade' <> 'alta' then raise exception 'FALHOU pendência: %', p; end if;
  raise notice 'ok  - 5 itens pendentes; ativos antigos também entram no alerta';
end $$;
-- gerente da loja: VR, crachá por equipamento, equipamento
select set_config('request.jwt.claims', json_build_object('sub',:'ger','aal','aal2')::text, true);
select public.admissao_registrar_item(:'ju', 'cartao_vr', current_date - 2, 'cartão 1234') as vr \gset
select public.equipamento_entregar(:'ju', current_date - 2, '[{"tipo":"Crachá"},{"tipo":"Celular","descricao":"Moto G"}]'::jsonb);
do $$ begin
  begin perform public.admissao_registrar_item(current_setting('teste.ju')::uuid, 'cartao_vr', current_date, null); raise exception 'FALHOU duplicou';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin insert into public.admissao_itens (colaborador_id, item, data_entrega) values (current_setting('teste.ju')::uuid, 'cracha', current_date); raise exception 'FALHOU insert direto';
  exception when insufficient_privilege then null; end;
  if (select count(*) from jsonb_array_elements(public.admissao_checklist(current_setting('teste.ju')::uuid)) x where (x->>'concluido')::boolean) <> 3
    then raise exception 'FALHOU 3 concluídos: %', public.admissao_checklist(current_setting('teste.ju')::uuid); end if;
  begin perform public.admissao_checklist((select id from public.colaboradores where nome_completo='CAIO OUTRA LOJA')); raise exception 'FALHOU gerente leu outra loja';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - VR manual, crachá e equipamento pela aba Equipamentos; gerente só a própria loja';
end $$;
-- diretoria: uniforme e termo de imagem
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.uniforme_item_salvar(null, 'Uniformes', 'Polo Teste', 'M', 1) as polo \gset
select public.uniforme_movimentar('entrada', jsonb_build_array(jsonb_build_object('item_id',:'polo','quantidade',5)), null, current_date, 'saldo');
select public.uniforme_movimentar('saida', jsonb_build_array(jsonb_build_object('item_id',:'polo','quantidade',2)), :'ju', current_date, null);
select documento_id as doc, versao_id as ver from public.documento_preparar_upload(null,
  jsonb_build_object('nome','Termo de uso de imagem','categoria_id',(select id from public.doc_categorias where codigo='termo_uso_imagem'),'colaborador_id',:'ju'),
  'termo.pdf','application/pdf',1024, repeat('b',64)) \gset
reset role;
insert into storage.objects (bucket_id, name) select 'documentos', storage_path from public.documento_versoes where id = :'ver';
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.documento_confirmar_upload(:'ver');
do $$ declare p jsonb; begin
  if exists (select 1 from jsonb_array_elements(public.admissao_checklist(current_setting('teste.ju')::uuid)) x where not (x->>'concluido')::boolean)
    then raise exception 'FALHOU todos concluídos: %', public.admissao_checklist(current_setting('teste.ju')::uuid); end if;
  select x into p from jsonb_array_elements(public.painel_pendencias()->'pendencias') x where x->>'chave' = 'admissao_itens';
  if (p->>'quantidade')::int <> 1 or p->'itens'->0->>'nome' <> 'CAIO OUTRA LOJA' then raise exception 'FALHOU pendência deveria ter só o Caio: %', p; end if;
  raise notice 'ok  - uniforme e termo concluem sozinhos; sai do alerta';
end $$;
-- desfazer VR volta a pendência
select public.admissao_cancelar_item(:'vr', 'cartão errado');
do $$ begin
  if (select (x->>'concluido')::boolean from jsonb_array_elements(public.admissao_checklist(current_setting('teste.ju')::uuid)) x where x->>'item'='cartao_vr')
    then raise exception 'FALHOU desfazer'; end if;
  raise notice 'ok  - desfazer registro com motivo';
end $$;
reset role;
select 'ADMISSAO ITENS OK';
rollback;
