-- =====================================================================
-- Correção: quem só ENVIA documento não forja autoria, assinatura nem
-- data de conferência de documento aprovado por UPDATE direto.
-- =====================================================================
begin;
insert into auth.users (email) values ('dir@doc91.local'), ('dp@doc91.local'), ('ger@doc91.local');
select privado.bootstrap_diretoria('dir@doc91.local');
update public.usuarios set mfa_obrigatorio = true;
select (select id from public.usuarios where email='dir@doc91.local') as dir,
       (select id from public.usuarios where email='dp@doc91.local') as dp,
       (select id from public.usuarios where email='ger@doc91.local') as ger \gset
select set_config('teste.dir', :'dir', false);
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.conceder_acesso(:'dp','departamento_pessoal');
select public.conceder_acesso(:'ger','gerente_loja',(select id from public.lojas where codigo='SOROCABA'));

-- DP envia e aprova um documento geral da loja de Sorocaba
select set_config('request.jwt.claims', json_build_object('sub',:'dp','aal','aal2')::text, true);
select documento_id as doc, versao_id as ver from public.documento_preparar_upload(null,
  jsonb_build_object('nome','Certificado','categoria_id',(select id from public.doc_categorias where codigo='treinamentos'),
                     'loja_id',(select id from public.lojas where codigo='SOROCABA')),
  'cert.pdf','application/pdf',1024, repeat('a',64)) \gset
-- simula a Edge Function gravando o arquivo no bucket (chave de serviço)
reset role;
insert into storage.objects (bucket_id, name) select 'documentos', storage_path from public.documento_versoes where id = :'ver';
set role authenticated;
select public.documento_confirmar_upload(:'ver');
select public.documento_conferir(:'doc', true, null);
select set_config('teste.doc', :'doc', false);

-- gerente (tem documento.geral.enviar na loja) tenta forjar campos
select set_config('request.jwt.claims', json_build_object('sub',:'ger','aal','aal2')::text, true);
do $$
declare d uuid := current_setting('teste.doc')::uuid; dir uuid := current_setting('teste.dir')::uuid;
begin
  if (select status::text from public.documentos where id = d) is distinct from 'aprovado' then
    raise exception 'FALHOU preparação: gerente deveria ver o documento aprovado';
  end if;
  begin update public.documentos set status_assinatura = 'assinado' where id = d;
    raise exception 'FALHOU gerente altera status da assinatura';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin update public.documentos set enviado_por = dir where id = d;
    raise exception 'FALHOU gerente forja enviado_por';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin update public.documentos set criado_por = dir where id = d;
    raise exception 'FALHOU gerente forja criado_por';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin update public.documentos set criado_em = now() - interval '1 year' where id = d;
    raise exception 'FALHOU gerente forja criado_em';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin update public.documentos set conferido_em = now() - interval '1 year' where id = d;
    raise exception 'FALHOU gerente forja conferido_em';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - quem envia não forja assinatura, autoria nem data de conferência';
end $$;

do $$
declare d uuid := current_setting('teste.doc')::uuid;
begin
  update public.documentos set nome = 'Certificado revisado', observacoes = 'obs', vencimento = date '2030-01-01'
   where id = d;
  if not exists (select 1 from public.documentos where id = d and nome = 'CERTIFICADO REVISADO'
                   and vencimento = date '2030-01-01' and status = 'aprovado') then
    raise exception 'FALHOU metadados livres deveriam continuar editáveis';
  end if;
  raise notice 'ok  - nome, observações e datas continuam editáveis';
end $$;

-- funções próprias continuam funcionando (nova versão volta para "recebido")
select set_config('request.jwt.claims', json_build_object('sub',:'dp','aal','aal2')::text, true);
select versao_id as ver2 from public.documento_preparar_upload(:'doc', '{}', 'cert2.pdf','application/pdf',1024, repeat('b',64), 'Revisão') \gset
reset role;
insert into storage.objects (bucket_id, name) select 'documentos', storage_path from public.documento_versoes where id = :'ver2';
set role authenticated;
select public.documento_confirmar_upload(:'ver2');
do $$ begin
  if (select status::text from public.documentos where id = current_setting('teste.doc')::uuid) <> 'recebido' then
    raise exception 'FALHOU confirmar upload deveria funcionar pela função';
  end if;
  raise notice 'ok  - confirmar upload e conferência seguem funcionando';
end $$;
reset role;
select 'CORRECOES DOCUMENTOS OK';
rollback;
