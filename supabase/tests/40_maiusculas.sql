begin;
insert into auth.users (email, raw_user_meta_data) values ('dir@m.local', '{"nome":"diego bonfim"}');
select privado.bootstrap_diretoria('dir@m.local');
select (select id from public.usuarios where email='dir@m.local') as dir \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','joão da silva','nome_social','jô','cpf','52998224725',
  'email','Joao@Email.com','logradouro','rua das flores','bairro','centro','cidade','são vicente','uf','sp',
  'loja_id',(select id from public.lojas where codigo='SOROCABA'),'matricula','abc1','tipo','clt_prazo_indeterminado',
  'status_inicial','ativo','data_admissao','2025-01-01','escala','6x1 seg a sab')) as col \gset
reset role;
do $$ declare c record; begin
  select * into c from public.colaboradores limit 1;
  if c.nome_completo <> 'JOÃO DA SILVA' or c.nome_social <> 'JÔ' or c.email <> 'JOAO@EMAIL.COM'
     or c.logradouro <> 'RUA DAS FLORES' or c.cidade <> 'SÃO VICENTE' or c.uf <> 'SP' then
    raise exception 'FALHOU colaborador: % % % %', c.nome_completo, c.email, c.cidade, c.uf; end if;
  if (select matricula || '|' || escala from public.vinculos limit 1) <> 'ABC1|6X1 SEG A SAB' then raise exception 'FALHOU vinculo'; end if;
  if (select nome from public.usuarios where email = 'dir@m.local') <> 'DIEGO BONFIM' then raise exception 'FALHOU usuario nome'; end if;
  if (select email from public.usuarios where nome = 'DIEGO BONFIM') <> 'dir@m.local' then raise exception 'FALHOU email login deveria ficar minusculo'; end if;
  if exists (select 1 from public.lojas where nome <> upper(nome)) then raise exception 'FALHOU lojas'; end if;
  if exists (select 1 from public.cargos where nome <> upper(nome)) then raise exception 'FALHOU cargos'; end if;
  if exists (select 1 from public.doc_categorias where nome <> upper(nome)) then raise exception 'FALHOU categorias'; end if;
  if exists (select 1 from public.eventos_timeline where titulo <> upper(titulo)) then raise exception 'FALHOU timeline'; end if;
  if exists (select 1 from public.doc_categorias where codigo <> lower(codigo)) then raise exception 'FALHOU codigo interno deveria ficar como esta'; end if;
  raise notice 'ok  - todo texto registrado fica em MAIUSCULAS (com acentos) e o e-mail de login permanece valido';
end $$;
select 'MAIUSCULAS OK';
rollback;
