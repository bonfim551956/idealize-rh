-- Avisos do painel: experiência, férias a vencer e aniversários (com escopo por loja)
begin;
insert into auth.users (email) values ('dir@p97.local'), ('ger@p97.local');
select privado.bootstrap_diretoria('dir@p97.local');
update public.usuarios set mfa_obrigatorio = true;
select (select id from public.usuarios where email='dir@p97.local') as dir,
       (select id from public.usuarios where email='ger@p97.local') as ger,
       (select id from public.lojas where codigo='SOROCABA') as sor,
       (select id from public.lojas where codigo='CAMPINAS') as cam \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.conceder_acesso(:'ger','gerente_loja',:'cam');
-- experiência: sem cargo = 15 + 15; admitida há 10 dias (1º período termina em 4 dias)
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Ana Experiencia','cpf','52998224725','loja_id',:'sor','matricula','901',
  'tipo','clt_experiencia','status_inicial','ativo','data_admissao',(current_date - 10)::text,
  'data_nascimento',(current_date + 5 - interval '30 years')::date::text)) as ana \gset
-- férias: admitido há 2 anos e 11 meses; 1º período gozado (30 dias), 2º período só 10 dias
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Bruno Ferias','cpf','11144477735','loja_id',:'sor','matricula','902',
  'tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao',(current_date - interval '35 months')::date::text,
  'data_nascimento','1990-01-01')) as bruno \gset
-- consultor: 15 + 30; admitido há 40 dias (prorrogação termina em 4 dias)
reset role;
insert into public.cargos (nome) values ('Consultor comercial teste') returning id as cons \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Diego Consultor','cpf','16899535009','loja_id',:'sor','matricula','904',
  'tipo','clt_experiencia','status_inicial','ativo','data_admissao',(current_date - 40)::text,'cargo_id',:'cons'));
-- experiência vencida (sem cargo, admitido há 50 dias e ainda marcado como experiência)
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Eva Vencida','cpf','74682489070','loja_id',:'sor','matricula','905',
  'tipo','clt_experiencia','status_inicial','ativo','data_admissao',(current_date - 50)::text));
-- loja que o gerente de Campinas não vê nem é o caso; colaborador de Campinas com aniversário amanhã
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Carla Campinas','cpf','39053344705','loja_id',:'cam','matricula','903',
  'tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2026-01-05',
  'data_nascimento',(current_date + 1 - interval '25 years')::date::text)) as carla \gset
reset role;
select set_config('teste.bruno', :'bruno', false);
do $$ declare b uuid := current_setting('teste.bruno')::uuid; adm date; a1 date; a2 date; begin
  select data_admissao into adm from public.vinculos where colaborador_id = b;
  a1 := adm; a2 := (adm + interval '1 year')::date;
  insert into public.eventos_timeline (colaborador_id, tipo, data_evento, titulo, descricao, sigilo)
  values (b, 'ferias', a2, 'Férias de ' || to_char(a2, 'DD/MM/YYYY') || ' a ' || to_char(a2 + 29, 'DD/MM/YYYY'),
          'Período aquisitivo ' || to_char(a1, 'DD/MM/YYYY') || ' a ' || to_char(a2 - 1, 'DD/MM/YYYY'), 'contratual'),
         (b, 'ferias', a2 + 200, 'Férias de ' || to_char(a2 + 200, 'DD/MM/YYYY') || ' a ' || to_char(a2 + 209, 'DD/MM/YYYY'),
          'Período aquisitivo ' || to_char(a2, 'DD/MM/YYYY') || ' a ' || to_char((a2 + interval '1 year')::date - 1, 'DD/MM/YYYY'), 'contratual');
end $$;

set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.painel_avisos() as av \gset
select set_config('teste.av', :'av', false);
do $$ declare av jsonb := current_setting('teste.av')::jsonb; f jsonb; begin
  if jsonb_array_length(av->'experiencia') <> 3 then raise exception 'FALHOU experiência: %', av->'experiencia'; end if;
  if not exists (select 1 from jsonb_array_elements(av->'experiencia') e where e->>'nome' = 'EVA VENCIDA' and e->>'fase' = 'vencido' and (e->>'dias')::int = -21) then
    raise exception 'FALHOU experiência vencida: %', av->'experiencia'; end if;
  if not exists (select 1 from jsonb_array_elements(av->'experiencia') e where e->>'nome' = 'ANA EXPERIENCIA' and e->>'fase' = 'primeiro' and (e->>'dias')::int = 4 and e->>'regra' = '15 + 15') then
    raise exception 'FALHOU experiência 15+15: %', av->'experiencia'; end if;
  if not exists (select 1 from jsonb_array_elements(av->'experiencia') e where e->>'nome' = 'DIEGO CONSULTOR' and e->>'fase' = 'prorrogacao' and (e->>'dias')::int = 4 and e->>'regra' = '15 + 30') then
    raise exception 'FALHOU experiência de consultor 15+30: %', av->'experiencia'; end if;
  if jsonb_array_length(av->'ferias') <> 1 then raise exception 'FALHOU férias: %', av->'ferias'; end if;
  f := av->'ferias'->0;
  if (f->>'dias_gozados')::int <> 10 or (f->>'saldo')::int <> 20 then raise exception 'FALHOU saldo de férias: %', f; end if;
  if (f->>'sair_ate')::date <> (f->>'concessivo_fim')::date - 19 then raise exception 'FALHOU data limite: %', f; end if;
  if jsonb_array_length(av->'aniversarios') <> 2 or (av->'aniversarios'->0->>'dias')::int <> 1 then
    raise exception 'FALHOU aniversários: %', av->'aniversarios'; end if;
  if (av->'aniversarios')::text ~ '19[0-9]{2}|20[01][0-9]' then raise exception 'FALHOU aniversário expõe ano de nascimento'; end if;
  raise notice 'ok  - experiência, férias (saldo e limite) e aniversários calculados';
end $$;
-- gerente de Campinas só vê Campinas
select set_config('request.jwt.claims', json_build_object('sub',:'ger','aal','aal2')::text, true);
select public.painel_avisos() as avg \gset
select set_config('teste.avg', :'avg', false);
do $$ declare av jsonb := current_setting('teste.avg')::jsonb; begin
  if jsonb_array_length(av->'experiencia') <> 0 or jsonb_array_length(av->'ferias') <> 0
     or jsonb_array_length(av->'aniversarios') <> 1 or (av->'aniversarios'->0->>'loja') not like '%CAMPINAS%' then
    raise exception 'FALHOU escopo do gerente: %', av; end if;
  raise notice 'ok  - gerente vê só a própria loja';
end $$;
reset role;
select 'AVISOS OK';
rollback;
