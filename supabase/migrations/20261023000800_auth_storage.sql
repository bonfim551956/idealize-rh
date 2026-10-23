-- =====================================================================
-- IDEALIZE RH 360º — Migração 008: integração com Supabase Auth e Storage
-- =====================================================================

-- Todo usuário criado no Auth ganha um registro em public.usuarios, ativo
-- mas SEM nenhuma atribuição — ou seja, sem acesso a nada até alguém com
-- 'acesso.gerir' conceder um perfil.
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

create trigger on_auth_user_created_idealize
  after insert on auth.users
  for each row execute function privado.novo_usuario_auth();

-- Bucket privado. Nenhuma política em storage.objects para anon/authenticated:
-- acesso a arquivos só pelas Edge Functions (chave de serviço) após checagem.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 20971520,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
