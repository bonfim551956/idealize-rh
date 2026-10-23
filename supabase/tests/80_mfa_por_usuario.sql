begin;
insert into auth.users (email) values ('dir@mfa.local'), ('dp@mfa.local');
select privado.bootstrap_diretoria('dir@mfa.local');
update public.usuarios set mfa_obrigatorio = true where email = 'dir@mfa.local';
select (select id from public.usuarios where email='dir@mfa.local') as dir, (select id from public.usuarios where email='dp@mfa.local') as dp \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.conceder_acesso(:'dp','departamento_pessoal',null);
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Ana','cpf','52998224725','loja_id',(select id from public.lojas where codigo='SOROCABA'),'matricula','1','tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2025-01-01','salario_base','2000'));

-- DP sem exigência: vê salário só com senha (aal1)
select set_config('request.jwt.claims', json_build_object('sub',:'dp','aal','aal1')::text, true);
do $$ begin
  if not exists (select 1 from public.remuneracoes) then raise exception 'FALHOU DP sem MFA não vê salário'; end if;
  if exists (select 1 from public.minhas_permissoes() where not liberada_na_sessao) then raise exception 'FALHOU permissões bloqueadas'; end if;
  begin perform public.definir_mfa_obrigatorio((select id from public.usuarios where email='dir@mfa.local'), false); raise exception 'FALHOU DP mexe no MFA do diretor';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - usuário sem exigência acessa dados sensíveis só com senha';
end $$;

-- Diretor com exigência: aal1 bloqueia
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal1')::text, true);
do $$ begin
  if exists (select 1 from public.remuneracoes) then raise exception 'FALHOU diretor sem MFA vê salário'; end if;
  begin perform public.definir_mfa_obrigatorio((select id from public.usuarios where email='dp@mfa.local'), true); raise exception 'FALHOU altera sem MFA';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - quem tem exigência continua precisando do autenticador';
end $$;

-- Diretor liga a exigência para o DP; não pode desligar a própria
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.definir_mfa_obrigatorio(:'dp', true);
do $$ begin
  begin perform public.definir_mfa_obrigatorio(auth.uid(), false); raise exception 'FALHOU desliga a própria';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
end $$;
select set_config('request.jwt.claims', json_build_object('sub',:'dp','aal','aal1')::text, true);
do $$ begin
  if exists (select 1 from public.remuneracoes) then raise exception 'FALHOU exigência religada não vale'; end if;
  raise notice 'ok  - exigência ligada pelo gestor vale na hora; ninguém altera a própria';
end $$;
reset role;
do $$ begin
  if not exists (select 1 from public.audit_log where tabela = 'usuarios' and dados_depois ? 'mfa_obrigatorio') then raise exception 'FALHOU auditoria'; end if;
  raise notice 'ok  - alteração auditada';
end $$;
select 'MFA POR USUARIO OK';
rollback;
