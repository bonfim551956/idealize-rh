begin;
insert into auth.users (email) values ('dir@c.local');
select privado.bootstrap_diretoria('dir@c.local');
select (select id from public.usuarios where email='dir@c.local') as dir \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Caio','cpf','52998224725','loja_id',(select id from public.lojas where codigo='SOROCABA'),'matricula','9','tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2025-01-01')) as col \gset
select (select id from public.vinculos where colaborador_id = :'col') as vinc \gset
select public.iniciar_desligamento(:'vinc', 'pedido_demissao', date '2026-10-01');
select public.alterar_status_vinculo(:'vinc', 'ativo', 'Desistiu do pedido');
do $$ begin if (select status from public.desligamentos limit 1) <> 'cancelado' then raise exception 'FALHOU processo não cancelado'; end if;
  raise notice 'ok  - cancelar desligamento encerra o processo como cancelado'; end $$;
select public.iniciar_desligamento(:'vinc', 'sem_justa_causa', date '2026-10-10') as d2 \gset
select public.concluir_desligamento(:'d2', date '2026-10-20');
do $$ begin
  if (select count(*) from public.desligamentos) <> 2 then raise exception 'FALHOU histórico'; end if;
  if (select status::text from public.vinculos limit 1) <> 'desligado' then raise exception 'FALHOU novo desligamento'; end if;
  raise notice 'ok  - novo desligamento após cancelamento funciona e o histórico é preservado'; end $$;
reset role;
select 'CANCELAMENTO OK';
rollback;
