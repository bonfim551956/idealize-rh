begin;
insert into auth.users (email) values ('dir@f102.local'), ('ger@f102.local');
select privado.bootstrap_diretoria('dir@f102.local');
update public.usuarios set mfa_obrigatorio = true;
select (select id from public.usuarios where email='dir@f102.local') as dir,
       (select id from public.usuarios where email='ger@f102.local') as ger,
       (select id from public.lojas where codigo='CAMPINAS') as cps \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.conceder_acesso(:'ger','gerente_loja',:'cps');
-- admitida há 3 anos: 2 períodos completos (o 1º vencido) e 1 em aquisição
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Thais Teste','cpf','52998224725','loja_id',:'cps','matricula','3001',
  'tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao',(current_date - interval '3 years' + interval '3 days')::date::text)) as th \gset
select set_config('teste.th', :'th', false);
create temp table r102 (k text, v jsonb); grant all on r102 to authenticated;
insert into r102 select 'antes', public.ferias_programacao();
do $$ declare j jsonb := (select v from r102 where k='antes'); begin
  if jsonb_array_length(j) <> 3 then raise exception 'FALHOU períodos: %', j; end if;
  if (j->0->>'situacao') <> 'vencida' then raise exception 'FALHOU 1º período deveria estar vencido: %', j->0; end if;
  if not exists (select 1 from jsonb_array_elements(public.painel_pendencias()->'pendencias') x where x->>'chave'='ferias' and x->>'gravidade'='alta')
    then raise exception 'FALHOU pendência de férias vencidas'; end if;
  raise notice 'ok  - períodos calculados; vencida aparece nas pendências';
end $$;
-- quita o 1º período
select public.ferias_lancar(jsonb_build_object('colaborador_id',:'th','modo','quitado',
  'aquisitivo_inicio',(current_date - interval '3 years' + interval '3 days')::date::text,'observacao','conforme contabilidade'));
-- 2º período: 20 dias + 10 abono, daqui a 30 dias
select public.ferias_lancar(jsonb_build_object('colaborador_id',:'th','modo','datas',
  'aquisitivo_inicio',(current_date - interval '2 years' + interval '3 days')::date::text,
  'data_inicio',(current_date + 30)::text,'dias',20,'abono',10));
do $$ declare j jsonb := public.ferias_programacao(); p jsonb; begin
  if jsonb_array_length(j) <> 2 then raise exception 'FALHOU quitado deveria sumir: %', j; end if;
  select x into p from jsonb_array_elements(j) x where x->>'situacao' = 'programada';
  if p is null or (p->>'programado_dias')::int <> 20 or (p->>'programado_abono')::int <> 10 or (p->>'saldo_livre')::numeric <> 0
    then raise exception 'FALHOU programada: %', j; end if;
  if exists (select 1 from jsonb_array_elements(public.painel_pendencias()->'pendencias') x where x->>'chave'='ferias')
    then raise exception 'FALHOU pendência deveria sumir'; end if;
  if exists (select 1 from jsonb_array_elements(public.painel_pendencias()->'pendencias') x where x->>'chave'='ferias_pagar')
    then raise exception 'FALHOU pagar férias antes da janela de 15 dias'; end if;
  begin perform public.ferias_lancar(jsonb_build_object('colaborador_id', current_setting('teste.th'), 'modo','datas',
      'aquisitivo_inicio', p->>'aquisitivo_inicio', 'data_inicio', (current_date + 90)::text, 'dias', 5));
    raise exception 'FALHOU passou do saldo';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin perform public.ferias_lancar(jsonb_build_object('colaborador_id', current_setting('teste.th'), 'modo','quitado',
      'aquisitivo_inicio', (select x->>'aquisitivo_inicio' from jsonb_array_elements(j) x where x->>'situacao'='em_aquisicao')));
    raise exception 'FALHOU quitou período incompleto';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  if (select abono_dias from public.ausencias where colaborador_id = current_setting('teste.th')::uuid) <> 10 then raise exception 'FALHOU abono'; end if;
  raise notice 'ok  - quitação, programação com abono, limites de saldo';
end $$;
-- férias daqui a 10 dias: aparece o pagamento
select public.ferias_lancar(jsonb_build_object('colaborador_id',:'th','modo','datas',
  'aquisitivo_inicio',(current_date - interval '1 years' + interval '3 days')::date::text,
  'data_inicio',(current_date + 10)::text,'dias',5,'abono',0));
do $$ begin
  if not exists (select 1 from jsonb_array_elements(public.painel_pendencias()->'pendencias') x
                  where x->>'chave'='ferias_pagar' and (x->>'quantidade')::int = 1 and x->'itens'->0->>'detalhe' like '%pagar até%')
    then raise exception 'FALHOU pagar férias: %', public.painel_pendencias(); end if;
  if extract(isodow from privado.prazo_pagamento_ferias(date '2026-12-14')) <> 5 or privado.prazo_pagamento_ferias(date '2026-12-14') <> date '2026-12-11'
    then raise exception 'FALHOU prazo no fim de semana'; end if;
  raise notice 'ok  - aviso de pagamento 15 dias antes, prazo volta para sexta';
end $$;

select set_config('request.jwt.claims', json_build_object('sub',:'ger','aal','aal2')::text, true);
do $$ begin
  if jsonb_array_length(public.ferias_programacao()) <> 2 then raise exception 'FALHOU gerente não vê'; end if;
  begin perform public.ferias_lancar(jsonb_build_object('colaborador_id', current_setting('teste.th'), 'modo','quitado',
      'aquisitivo_inicio', (current_date - interval '2 years' + interval '3 days')::date::text));
    raise exception 'FALHOU gerente lançou';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin insert into public.ferias_quitacoes (colaborador_id, aquisitivo_inicio) values (current_setting('teste.th')::uuid, current_date);
    raise exception 'FALHOU insert direto';
  exception when insufficient_privilege then null; end;
  raise notice 'ok  - gerente só consulta';
end $$;
reset role;
select 'FERIAS OK';
rollback;
