begin;
insert into auth.users (email) values ('dir@f101.local'), ('ger@f101.local');
select privado.bootstrap_diretoria('dir@f101.local');
update public.usuarios set mfa_obrigatorio = true;
select (select id from public.usuarios where email='dir@f101.local') as dir,
       (select id from public.usuarios where email='ger@f101.local') as ger,
       (select id from public.lojas where codigo='SOROCABA') as sor,
       (select id from public.lojas where codigo='CAMPINAS') as cps \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.conceder_acesso(:'ger','gerente_loja',:'sor');
-- Sorocaba: experiência encerrada sem atualização, sem VT, com equipamento sem termo
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Ana Pend','cpf','52998224725','loja_id',:'sor','matricula','2001',
  'tipo','clt_experiencia','status_inicial','ativo','data_admissao',(current_date - 50)::text)) as ana \gset
select public.equipamento_entregar(:'ana', current_date - 3, '[{"tipo":"celular","descricao":"moto g"}]'::jsonb);
-- Campinas: outra loja, também sem VT
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Bruno Outra','cpf','11144477735','loja_id',:'cps','matricula','2002',
  'tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao',(current_date - 200)::text)) as bruno \gset

create temp table p101 (quem text, chave text, qtd int, grav text, itens jsonb);
grant all on p101 to authenticated;
insert into p101 select 'dir', x->>'chave', (x->>'quantidade')::int, x->>'gravidade', x->'itens'
  from jsonb_array_elements(public.painel_pendencias()->'pendencias') x;
insert into p101 select 'dir_cps', x->>'chave', (x->>'quantidade')::int, x->>'gravidade', x->'itens'
  from jsonb_array_elements(public.painel_pendencias(:'cps')->'pendencias') x;
select set_config('request.jwt.claims', json_build_object('sub',:'ger','aal','aal2')::text, true);
insert into p101 select 'ger', x->>'chave', (x->>'quantidade')::int, x->>'gravidade', x->'itens'
  from jsonb_array_elements(public.painel_pendencias()->'pendencias') x;

do $$ begin
  if not exists (select 1 from p101 where quem='dir' and chave='experiencia' and grav='alta') then raise exception 'FALHOU experiência encerrada'; end if;
  if (select qtd from p101 where quem='dir' and chave='vt_cadastro') <> 2 then raise exception 'FALHOU vt cadastro diretoria'; end if;
  if (select qtd from p101 where quem='dir' and chave='equip_sem_termo') <> 1 then raise exception 'FALHOU equipamento sem termo'; end if;
  if (select qtd from p101 where quem='dir_cps' and chave='vt_cadastro') <> 1 then raise exception 'FALHOU filtro de loja'; end if;
  if exists (select 1 from p101 where quem='dir_cps' and chave='equip_sem_termo') then raise exception 'FALHOU filtro de loja equip'; end if;
  raise notice 'ok  - diretoria vê as pendências, filtro por loja funciona';
  if exists (select 1 from p101 where quem='ger' and chave in ('vt_cadastro', 'convites')) then raise exception 'FALHOU gerente vê VT/convites'; end if;
  if not exists (select 1 from p101 where quem='ger' and chave='equip_sem_termo') then raise exception 'FALHOU gerente não vê equipamento'; end if;
  if exists (select 1 from p101 p, jsonb_array_elements(p.itens) i where p.quem='ger' and i->>'nome' = 'BRUNO OUTRA') then raise exception 'FALHOU gerente vê outra loja'; end if;
  raise notice 'ok  - gerente só vê o que a permissão e a loja permitem';
end $$;
reset role;
set role anon;
do $$ begin
  begin perform public.painel_pendencias(); raise exception 'FALHOU anon executou';
  exception when insufficient_privilege then null; end;
  raise notice 'ok  - anônimo não acessa';
end $$;
reset role;
select 'PENDENCIAS OK';
rollback;
