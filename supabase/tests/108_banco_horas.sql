-- Banco de horas (robô VR)
begin;
insert into auth.users (email) values ('dir@b108.local'), ('ger@b108.local');
select privado.bootstrap_diretoria('dir@b108.local');
update public.usuarios set mfa_obrigatorio = true;
insert into privado.robo_chaves (nome, hash) values ('banco_horas', encode(extensions.digest('chave-teste-108', 'sha256'), 'hex'));
select (select id from public.usuarios where email='dir@b108.local') as dir,
       (select id from public.usuarios where email='ger@b108.local') as ger,
       (select id from public.lojas where codigo='SOROCABA') as sor \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.conceder_acesso(:'ger','gerente_loja',:'sor');
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Adilma Batista Rocha','cpf','52998224725','loja_id',:'sor','matricula','1081',
  'tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2024-01-10')) as adi \gset
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Joao Sem Nome Igual','cpf','11144477735','loja_id',:'sor','matricula','1082',
  'tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2024-01-10')) as joao \gset
select set_config('teste.joao', :'joao', false), set_config('teste.adi', :'adi', false);
reset role;
set role anon;
do $$ begin
  begin perform public.banco_horas_receber('errada', '{"status":"ok"}', '[]'); raise exception 'FALHOU aceitou chave errada';
  exception when insufficient_privilege then null; end;
  perform public.banco_horas_receber('chave-teste-108', '{"status":"ok","periodo_inicio":"2026-11-01","periodo_fim":"2026-11-10"}',
    '[{"nome":"ADILMA BATISTA ROCHA","departamento":"SOROCABA - OPERAÇÕES","data":"2026-11-09","saldo_min":-6207,"positivas_min":0,"negativas_min":-475},
      {"nome":"Adilma Batista Rocha","data":"2026-11-10","saldo_min":-6200,"positivas_min":7,"negativas_min":0},
      {"nome":"JOÃO S. N. IGUAL","data":"2026-11-10","saldo_min":300,"positivas_min":60,"negativas_min":0}]');
  begin perform 1 from public.banco_horas_saldos; raise exception 'FALHOU anon leu tabela';
  exception when insufficient_privilege then null; end;
  raise notice 'ok  - robô grava com a chave certa; recusa chave errada';
end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
do $$ declare r jsonb := public.banco_horas_resumo(null); begin
  if jsonb_array_length(r->'linhas') <> 1 or (r->'linhas'->0->>'saldo_min')::int <> -6200 or r->'linhas'->0->>'colaborador_id' <> current_setting('teste.adi')
     or jsonb_array_length(r->'sem_vinculo') <> 1 or r->'ultima_ok'->>'pessoas' <> '2' then raise exception 'FALHOU resumo: %', r; end if;
  perform public.banco_horas_vincular(r->'sem_vinculo'->0->>'nome_norm', current_setting('teste.joao')::uuid);
  r := public.banco_horas_resumo(null);
  if jsonb_array_length(r->'linhas') <> 2 or jsonb_array_length(r->'sem_vinculo') <> 0 then raise exception 'FALHOU vincular: %', r; end if;
  if jsonb_array_length(public.banco_horas_historico(current_setting('teste.adi')::uuid, 30)) <> 2 then raise exception 'FALHOU histórico'; end if;
  raise notice 'ok  - casa pelo nome, vínculo manual, histórico';
end $$;
select set_config('request.jwt.claims', json_build_object('sub',:'ger','aal','aal2')::text, true);
do $$ declare r jsonb := public.banco_horas_resumo(null); begin
  if jsonb_array_length(r->'linhas') <> 2 or jsonb_array_length(r->'sem_vinculo') <> 0 then raise exception 'FALHOU gerente: %', r; end if;
  raise notice 'ok  - gerente vê a própria loja';
end $$;
reset role;
select 'BANCO DE HORAS OK';
rollback;
