-- Vale-transporte: dias do mês, ausências, pagamento antecipado e fechamento
begin;
insert into auth.users (email) values ('dir@vt98.local'), ('ger@vt98.local');
select privado.bootstrap_diretoria('dir@vt98.local');
update public.usuarios set mfa_obrigatorio = true;
select (select id from public.usuarios where email='dir@vt98.local') as dir,
       (select id from public.usuarios where email='ger@vt98.local') as ger,
       (select id from public.lojas where codigo='SOROCABA') as sor \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.conceder_acesso(:'ger','gerente_loja',:'sor');

do $$ begin
  -- outubro/2026: 31 dias, 4 domingos => 27; dezembro/2026: 31 - 4 domingos - 25/12 => 26; janeiro/2027: 31 - 5 domingos - 01/01 => 25
  if privado.dias_vt('2026-10-01','2026-10-31') <> 27 then raise exception 'FALHOU dias de outubro: %', privado.dias_vt('2026-10-01','2026-10-31'); end if;
  if privado.dias_vt('2026-12-01','2026-12-31') <> 26 then raise exception 'FALHOU dias de dezembro'; end if;
  if privado.dias_vt('2027-01-01','2027-01-31') <> 25 then raise exception 'FALHOU dias de janeiro'; end if;
  raise notice 'ok  - dias do VT: todos menos domingos, 25/12 e 01/01';
end $$;

select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Ana VT','cpf','52998224725','loja_id',:'sor','matricula','981',
  'tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2026-01-05')) as ana \gset
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Bia Nova','cpf','11144477735','loja_id',:'sor','matricula','982',
  'tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2026-11-16')) as bia \gset
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Caio Home','cpf','39053344705','loja_id',:'sor','matricula','983',
  'tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2026-01-05')) as caio \gset
select public.vt_salvar(:'ana', true, 10.60, null);
select public.vt_salvar(:'bia', true, 12, null);
select public.vt_salvar(:'caio', false, null, 'home office');

-- outubro: 1 falta (sábado 10/10), atestado 15 e 16/10 (qui e sex) e declaração de horas (não conta)
select public.ausencia_registrar(jsonb_build_object('colaborador_id',:'ana','tipo','falta_injustificada','data_inicio','2026-10-10'));
select public.ausencia_registrar(jsonb_build_object('colaborador_id',:'ana','tipo','atestado','data_inicio','2026-10-15','data_fim','2026-10-16'));
select public.ausencia_registrar(jsonb_build_object('colaborador_id',:'ana','tipo','declaracao_horas','data_inicio','2026-10-20','horario','15h às 16h'));
-- novembro: férias de 23 a 30/11 (7 dias contáveis: 23..28 seg-sáb = 6 + 30 seg = 7; 29 é domingo)
select public.ausencia_registrar(jsonb_build_object('colaborador_id',:'ana','tipo','ferias','data_inicio','2026-11-23','data_fim','2026-11-30','aquisitivo_inicio','2026-01-05'));

do $$ declare r record; begin
  -- novembro/2026 tem 30 dias e 5 domingos => 25 dias
  select * into r from public.vt_calculo('2026-11-01') where nome = 'ANA VT';
  if r.dias_base <> 25 or r.dias_excluidos <> 7 or r.ausencias_mes_anterior <> 3 or r.dias_pagar <> 15 or r.valor <> 159.00 then
    raise exception 'FALHOU cálculo Ana: %', row_to_json(r); end if;
  select * into r from public.vt_calculo('2026-11-01') where nome = 'BIA NOVA';
  -- admitida 16/11 (seg): 16..30 = 15 dias - 2 domingos = 13
  if r.dias_base <> 13 or r.dias_pagar <> 13 or r.valor <> 156.00 then raise exception 'FALHOU admissão no meio do mês: %', row_to_json(r); end if;
  select * into r from public.vt_calculo('2026-11-01') where nome = 'CAIO HOME';
  if r.situacao <> 'nao_recebe' or r.valor <> 0 then raise exception 'FALHOU home office: %', row_to_json(r); end if;
  raise notice 'ok  - cálculo: dias do mês, férias do mês, ausências do mês anterior, admissão e quem não recebe';
end $$;

-- fecha novembro; em dezembro as férias de novembro já excluídas não descontam de novo
select public.vt_fechar('2026-11-01') as n \gset
do $$ declare r record; begin
  select * into r from public.vt_calculo('2026-12-01') where nome = 'ANA VT';
  if r.ausencias_mes_anterior <> 7 or r.ja_descontado <> 7 or r.dias_desconto_anterior <> 0 or r.dias_pagar <> 26 then
    raise exception 'FALHOU desconto em dobro: %', row_to_json(r); end if;
  select * into r from public.vt_calculo('2026-11-01') where nome = 'ANA VT';
  if not r.fechado or r.fechado_valor <> 159.00 then raise exception 'FALHOU fechamento: %', row_to_json(r); end if;
  begin perform public.vt_fechar('2026-11-01'); raise exception 'FALHOU fechou duas vezes';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - fechamento guarda o pago e evita desconto em dobro';
end $$;

-- cancelamento devolve os dias
select id as aus from public.v_ausencias where tipo = 'atestado' and nome = 'ANA VT' \gset
select public.ausencia_cancelar(:'aus', 'lançado errado');
do $$ begin
  if (select ausencias_mes_anterior from public.vt_calculo('2026-11-01') where nome = 'ANA VT') <> 1 then raise exception 'FALHOU cancelamento'; end if;
  begin update public.ausencias set data_fim = data_fim + 1; raise exception 'FALHOU alterou ausência direto';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - cancelamento com motivo; ausência não muda por fora';
end $$;

-- gerente de loja não vê VT nem ausências
select set_config('request.jwt.claims', json_build_object('sub',:'ger','aal','aal2')::text, true);
do $$ begin
  if exists (select 1 from public.vt_calculo('2026-11-01')) or exists (select 1 from public.v_ausencias) or exists (select 1 from public.vt_cadastros) then
    raise exception 'FALHOU gerente vê VT/ausências'; end if;
  begin perform public.vt_salvar((select id from public.v_colaboradores limit 1), true, 1, null); raise exception 'FALHOU gerente salvou VT';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - gerente sem acesso ao VT e às ausências';
end $$;
reset role;
select 'VT OK';
rollback;
