-- =====================================================================
-- Correção: documento_confirmar_upload chamado direto via PostgREST
--   1) sem arquivo no storage → recusado
--   2) documento arquivado → recusado (não desarquiva)
--   3) versão antiga depois de uma mais nova → recusada (sem rollback)
-- =====================================================================
begin;
insert into auth.users (email) values ('dir@upload.local'), ('ger@upload.local');
select privado.bootstrap_diretoria('dir@upload.local');
select (select id from public.usuarios where email = 'dir@upload.local') as dir,
       (select id from public.usuarios where email = 'ger@upload.local') as ger,
       (select id from public.lojas where codigo = 'SOROCABA') as loja,
       (select id from public.doc_categorias where codigo = 'treinamentos') as cat \gset

set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','role','authenticated','aal','aal2')::text, true);
select public.conceder_acesso(:'ger', 'gerente_loja', :'loja');

-- gerente (envia documentos gerais, mas NÃO tem documento.arquivar)
select set_config('request.jwt.claims', json_build_object('sub',:'ger','role','authenticated','aal','aal2')::text, true);
select documento_id as doc, versao_id as v1, storage_path as p1
  from public.documento_preparar_upload(null,
       jsonb_build_object('nome','Treinamento loja','categoria_id',:'cat','loja_id',:'loja'),
       'cert.pdf', 'application/pdf', 1024, repeat('a', 64)) \gset
select set_config('teste.doc', :'doc', false), set_config('teste.v1', :'v1', false);

-- 1) confirmação direta sem arquivo gravado
do $$ begin
  begin
    perform public.documento_confirmar_upload(current_setting('teste.v1')::uuid);
    raise exception 'FALHOU confirmou versão sem arquivo no storage';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  if (select versao_atual from public.documentos where id = current_setting('teste.doc')::uuid) is distinct from 0 then
    raise exception 'FALHOU versão sem arquivo virou a versão atual';
  end if;
  raise notice 'ok  - confirmação sem arquivo no storage é recusada';
end $$;

-- fluxo normal: a Edge Function grava o arquivo (chave de serviço) e confirma
reset role;
insert into storage.objects (bucket_id, name) values ('documentos', :'p1');
set role authenticated;
select public.documento_confirmar_upload(:'v1');
do $$ begin
  if (select status::text || '|' || versao_atual from public.documentos where id = current_setting('teste.doc')::uuid) is distinct from 'recebido|1' then
    raise exception 'FALHOU fluxo normal da Edge Function deixou de funcionar';
  end if;
  raise notice 'ok  - com o arquivo gravado a confirmação funciona';
end $$;

-- 2) gerente reserva v2, diretoria arquiva, gerente tenta confirmar
select versao_id as v2, storage_path as p2
  from public.documento_preparar_upload(:'doc', '{}', 'cert2.pdf', 'application/pdf', 1024, repeat('b', 64), 'Correção') \gset
select set_config('teste.v2', :'v2', false);
reset role;
insert into storage.objects (bucket_id, name) values ('documentos', :'p2');
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','role','authenticated','aal','aal2')::text, true);
select public.documento_arquivar(:'doc', 'Encerrado');
select set_config('request.jwt.claims', json_build_object('sub',:'ger','role','authenticated','aal','aal2')::text, true);
do $$ begin
  begin
    perform public.documento_confirmar_upload(current_setting('teste.v2')::uuid);
    raise exception 'FALHOU confirmação desarquivou o documento';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  if (select status::text from public.documentos where id = current_setting('teste.doc')::uuid) is distinct from 'arquivado' then
    raise exception 'FALHOU documento saiu de "arquivado"';
  end if;
  raise notice 'ok  - documento arquivado não é desarquivado pela confirmação';
end $$;

-- 3) versão antiga confirmada depois de uma mais nova
select documento_id as doc2, versao_id as w1, storage_path as q1
  from public.documento_preparar_upload(null,
       jsonb_build_object('nome','Treinamento 2','categoria_id',:'cat','loja_id',:'loja'),
       'c.pdf', 'application/pdf', 1024, repeat('c', 64)) \gset
reset role;
insert into storage.objects (bucket_id, name) values ('documentos', :'q1');
set role authenticated;
select public.documento_confirmar_upload(:'w1');
select versao_id as w2, storage_path as q2
  from public.documento_preparar_upload(:'doc2', '{}', 'c2.pdf', 'application/pdf', 1024, repeat('d', 64), 'v2') \gset
select versao_id as w3, storage_path as q3
  from public.documento_preparar_upload(:'doc2', '{}', 'c3.pdf', 'application/pdf', 1024, repeat('e', 64), 'v3') \gset
reset role;
insert into storage.objects (bucket_id, name) values ('documentos', :'q2'), ('documentos', :'q3');
set role authenticated;
select public.documento_confirmar_upload(:'w3');
select set_config('teste.doc2', :'doc2', false), set_config('teste.w2', :'w2', false);
do $$ begin
  begin
    perform public.documento_confirmar_upload(current_setting('teste.w2')::uuid);
    raise exception 'FALHOU versão antiga substituiu a mais nova';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  if (select versao_atual from public.documentos where id = current_setting('teste.doc2')::uuid) is distinct from 3 then
    raise exception 'FALHOU versão atual voltou para trás';
  end if;
  raise notice 'ok  - versão desatualizada não volta a ser a atual';
end $$;

reset role;
select 'CORRECOES UPLOAD OK';
rollback;
