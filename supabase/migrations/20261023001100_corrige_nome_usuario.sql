-- Nome automático do usuário nunca pode ter menos de 2 caracteres (ex.: d@empresa.com)
create or replace function privado.novo_usuario_auth()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.usuarios (id, nome, email)
  values (new.id,
          case
            when length(trim(coalesce(new.raw_user_meta_data ->> 'nome', ''))) >= 2 then trim(new.raw_user_meta_data ->> 'nome')
            when length(split_part(new.email, '@', 1)) >= 2 then split_part(new.email, '@', 1)
            else lower(new.email)
          end,
          lower(new.email))
  on conflict (id) do nothing;
  return new;
end $$;
