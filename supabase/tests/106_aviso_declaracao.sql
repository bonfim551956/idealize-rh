-- Aviso prévio no desligamento + Declaração com horário e CID
begin;
insert into auth.users (email) values ('dir@f106.local');
select privado.bootstrap_diretoria('dir@f106.local');
update public.usuarios set mfa_obrigatorio = true;
select (select id from public.usuarios where email='dir@f106.local') as dir,
       (select id from public.lojas where codigo='SOROCABA') as sor \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Ana Aviso','cpf','52998224725','loja_id',:'sor','matricula','1061',
  'tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2023-05-02')) as ana \gset
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Bia Pedido','cpf','11144477735','loja_id',:'sor','matricula','1062',
  'tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2024-01-10')) as bia \gset
select (select id from public.vinculos where colaborador_id=:'ana') as va, (select id from public.vinculos where colaborador_id=:'bia') as vb \gset
select set_config('teste.va', :'va', false), set_config('teste.vb', :'vb', false);

do $$ begin
  begin perform public.iniciar_desligamento(current_setting('teste.va')::uuid, 'sem_justa_causa', date '2026-11-10', null,
      '{"tipo":"trabalhado","dias":39,"fim_aviso":"2026-12-18","ultimo_dia":"2026-12-11"}');
    raise exception 'FALHOU aceitou trabalhado sem redução';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin perform public.iniciar_desligamento(current_setting('teste.va')::uuid, 'sem_justa_causa', date '2026-11-10', null, '{"tipo":"nao_cumpre","ultimo_dia":"2026-11-10"}');
    raise exception 'FALHOU aceitou nao_cumpre em dispensa';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  perform public.iniciar_desligamento(current_setting('teste.va')::uuid, 'sem_justa_causa', date '2026-11-10', null,
      '{"tipo":"trabalhado","reducao":"7_dias","dias":39,"fim_aviso":"2026-12-18","ultimo_dia":"2026-12-11"}');
  perform public.iniciar_desligamento(current_setting('teste.vb')::uuid, 'pedido_demissao', date '2026-11-10', null,
      '{"tipo":"trabalhado","reducao":"2h_dia","dias":30,"fim_aviso":"2026-12-09","ultimo_dia":"2026-12-09"}');
  if (select aviso_reducao||ultimo_dia::text||aviso_dias from public.desligamentos where vinculo_id = current_setting('teste.va')::uuid) <> '7_dias2026-12-1139'
    then raise exception 'FALHOU gravação do aviso'; end if;
  if (select aviso_reducao from public.desligamentos where vinculo_id = current_setting('teste.vb')::uuid) is not null
    then raise exception 'FALHOU pedido de demissão não tem redução'; end if;
  raise notice 'ok  - aviso prévio validado e gravado';
end $$;

-- declaração com horário e CID
select id as cat_decl from public.doc_categorias where codigo='declaracao_comparecimento' \gset
select id as cat_outros from public.doc_categorias where codigo='outros' \gset
select documento_id as doc from public.documento_preparar_upload(null,
  jsonb_build_object('categoria_id',:'cat_decl','colaborador_id',:'ana','nome','Declaração','horario_inicio','14:00','horario_fim','16:30','cid','z00.0'),
  'd.pdf','application/pdf',10, repeat('a',64)) \gset
select set_config('teste.doc', :'doc', false), set_config('teste.outros', :'cat_outros', false), set_config('teste.ana', :'ana', false);
do $$ declare r record; begin
  select * into r from public.v_documentos where id = current_setting('teste.doc')::uuid;
  if r.horario_inicio <> '14:00' or r.horario_fim <> '16:30' or r.cid <> 'Z00.0' or r.categoria_codigo <> 'declaracao_comparecimento'
    then raise exception 'FALHOU campos da declaração: %', row_to_json(r); end if;
  begin perform public.documento_preparar_upload(null,
      jsonb_build_object('categoria_id',current_setting('teste.outros'),'colaborador_id',current_setting('teste.ana'),'nome','X','cid','J11'),
      'x.pdf','application/pdf',10, repeat('c',64));
    raise exception 'FALHOU aceitou CID fora de saúde';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin perform public.documento_ajustar_horario(current_setting('teste.doc')::uuid, '16:00', '15:00', null);
    raise exception 'FALHOU aceitou horário invertido';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  perform public.documento_ajustar_horario(current_setting('teste.doc')::uuid, '13:00', '15:00', 'j11');
  if (select cid from public.documentos where id = current_setting('teste.doc')::uuid) <> 'J11' then raise exception 'FALHOU ajuste'; end if;
  raise notice 'ok  - declaração com horário e CID; CID só em saúde; ajuste depois';
end $$;
reset role;
select 'AVISO E DECLARACAO OK';
rollback;
