-- Convites pendentes: só quem gerencia acessos vê; some depois que a pessoa ativa a conta
begin;
insert into auth.users (email) values ('dir@c95.local');
insert into auth.users (email, invited_at) values ('nova@c95.local', now()), ('ativa@c95.local', now());
update auth.users set email_confirmed_at = now(), last_sign_in_at = now() where email in ('dir@c95.local', 'ativa@c95.local');
select privado.bootstrap_diretoria('dir@c95.local');
update public.usuarios set mfa_obrigatorio = true;
select (select id from public.usuarios where email='dir@c95.local') as dir,
       (select id from public.usuarios where email='nova@c95.local') as nova,
       (select id from public.usuarios where email='ativa@c95.local') as ativa \gset
select set_config('teste.nova', :'nova', false);
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
do $$ begin
  if (select count(*) from public.usuarios_convites_pendentes()) <> 1
     or not exists (select 1 from public.usuarios_convites_pendentes() where usuario_id = current_setting('teste.nova')::uuid) then
    raise exception 'FALHOU lista de convites pendentes';
  end if;
  raise notice 'ok  - lista só quem não ativou a conta';
end $$;
select set_config('request.jwt.claims', json_build_object('sub',:'ativa','aal','aal2')::text, true);
do $$ begin
  begin perform public.usuarios_convites_pendentes(); raise exception 'FALHOU sem permissão viu convites';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - sem acesso.gerir não vê convites';
end $$;
reset role;
select 'CONVITES OK';
rollback;
