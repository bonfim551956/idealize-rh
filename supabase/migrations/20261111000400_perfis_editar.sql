-- Tela "Perfis e permissões": quem tem acesso.gerir edita o que cada perfil pode fazer
-- e cria perfis novos. Tudo auditado. Ninguém altera um perfil que ele mesmo tem
-- (mesma regra de "ninguém concede acesso a si mesmo").

drop trigger if exists auditar on public.perfis;
create trigger auditar after insert or update or delete on public.perfis
  for each row execute function privado.auditar();

create or replace function privado.perfil_do_proprio(p_perfil uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.usuario_atribuicoes a
     where a.usuario_id = auth.uid() and a.perfil_id = p_perfil and a.ativo
       and (a.valido_ate is null or a.valido_ate > now()));
$$;

-- Define a lista completa de permissões de um perfil (o que não vier é retirado).
create or replace function public.perfil_permissoes_definir(p_perfil uuid, p_permissoes text[], p_motivo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_perfil public.perfis;
  v_antes text[];
  v_novas text[] := coalesce(p_permissoes, '{}');
  v_add text[]; v_rem text[];
begin
  perform privado.exigir('acesso.gerir', null);
  select * into v_perfil from public.perfis where id = p_perfil;
  if v_perfil.id is null then raise exception 'Perfil não encontrado'; end if;
  if v_perfil.codigo = 'colaborador' then
    raise exception 'O perfil COLABORADOR é o acesso do próprio funcionário e não recebe permissões de gestão';
  end if;
  if privado.perfil_do_proprio(p_perfil) then
    raise exception 'Você tem este perfil: outra pessoa que gerencia acessos precisa alterá-lo' using errcode = '42501';
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da alteração'; end if;
  if exists (select 1 from unnest(v_novas) x where not exists (select 1 from public.permissoes p where p.codigo = x)) then
    raise exception 'Permissão desconhecida na lista';
  end if;
  -- sempre precisa sobrar alguém que gerencie acessos
  if not ('acesso.gerir' = any (v_novas)) and not exists (
    select 1 from public.usuario_atribuicoes a
      join public.perfil_permissoes pp on pp.perfil_id = a.perfil_id and pp.permissao = 'acesso.gerir'
      join public.usuarios u on u.id = a.usuario_id and u.ativo
     where a.ativo and (a.valido_ate is null or a.valido_ate > now()) and a.perfil_id <> p_perfil) then
    raise exception 'Não é possível retirar "gerenciar acessos": ninguém mais conseguiria administrar o sistema';
  end if;

  select coalesce(array_agg(permissao order by permissao), '{}') into v_antes
    from public.perfil_permissoes where perfil_id = p_perfil;
  select coalesce(array_agg(x order by x), '{}') into v_add from unnest(v_novas) x where not (x = any (v_antes));
  select coalesce(array_agg(x order by x), '{}') into v_rem from unnest(v_antes) x where not (x = any (v_novas));

  delete from public.perfil_permissoes where perfil_id = p_perfil and permissao = any (v_rem);
  insert into public.perfil_permissoes (perfil_id, permissao)
    select p_perfil, x from unnest(v_add) x on conflict do nothing;

  insert into public.audit_log (usuario_id, acao, tabela, registro_id, dados_antes, dados_depois, contexto)
  values (auth.uid(), 'PERFIL_PERMISSOES', 'perfis', p_perfil::text,
          jsonb_build_object('permissoes', to_jsonb(v_antes)),
          jsonb_build_object('permissoes', to_jsonb(v_novas)),
          jsonb_build_object('motivo', trim(p_motivo), 'incluidas', to_jsonb(v_add), 'retiradas', to_jsonb(v_rem)));

  return jsonb_build_object('incluidas', to_jsonb(v_add), 'retiradas', to_jsonb(v_rem));
end $$;

-- Cria (p_id nulo) ou renomeia/descreve um perfil. Ao criar, pode copiar as permissões de outro.
create or replace function public.perfil_salvar(p_id uuid, p_nome text, p_descricao text, p_copiar_de uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_codigo text; v_sis boolean;
begin
  perform privado.exigir('acesso.gerir', null);
  if coalesce(trim(p_nome), '') = '' then raise exception 'Informe o nome do perfil'; end if;
  if p_id is null then
    v_codigo := trim(both '_' from regexp_replace(translate(lower(trim(p_nome)), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '[^a-z0-9]+', '_', 'g'));
    if v_codigo = '' or exists (select 1 from public.perfis where codigo = v_codigo or upper(nome) = upper(trim(p_nome))) then
      raise exception 'Já existe um perfil com esse nome';
    end if;
    insert into public.perfis (codigo, nome, descricao, de_sistema)
      values (v_codigo, trim(p_nome), nullif(trim(p_descricao), ''), false) returning id into v_id;
    if p_copiar_de is not null then
      insert into public.perfil_permissoes (perfil_id, permissao)
        select v_id, permissao from public.perfil_permissoes where perfil_id = p_copiar_de;
    end if;
    return v_id;
  end if;
  select de_sistema into v_sis from public.perfis where id = p_id;
  if not found then raise exception 'Perfil não encontrado'; end if;
  if privado.perfil_do_proprio(p_id) then
    raise exception 'Você tem este perfil: outra pessoa que gerencia acessos precisa alterá-lo' using errcode = '42501';
  end if;
  -- perfis do sistema mantêm o nome (outras telas dependem dele); só a descrição muda
  update public.perfis set nome = case when v_sis then nome else trim(p_nome) end,
                           descricao = nullif(trim(p_descricao), '')
   where id = p_id;
  return p_id;
end $$;

revoke all on function public.perfil_permissoes_definir(uuid, text[], text) from public, anon;
revoke all on function public.perfil_salvar(uuid, text, text, uuid) from public, anon;
grant execute on function public.perfil_permissoes_definir(uuid, text[], text) to authenticated;
grant execute on function public.perfil_salvar(uuid, text, text, uuid) to authenticated;

-- Trocar o perfil/escopo de uma pessoa num passo só (revoga o acesso antigo e concede o novo, tudo ou nada).
create or replace function public.trocar_acesso(p_atribuicao uuid, p_perfil_codigo text, p_loja uuid, p_valido_ate timestamptz, p_motivo text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_usuario uuid; v_novo uuid;
begin
  perform privado.exigir('acesso.gerir', null);
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da alteração'; end if;
  select usuario_id into v_usuario from public.usuario_atribuicoes where id = p_atribuicao and ativo;
  if v_usuario is null then raise exception 'Acesso não encontrado ou já revogado'; end if;
  if v_usuario = auth.uid() then raise exception 'Não é permitido alterar o próprio acesso' using errcode = '42501'; end if;
  perform public.revogar_acesso(p_atribuicao, 'ALTERADO: ' || trim(p_motivo));
  v_novo := public.conceder_acesso(v_usuario, p_perfil_codigo, p_loja, trim(p_motivo), p_valido_ate);
  return v_novo;
end $$;
revoke all on function public.trocar_acesso(uuid, text, uuid, timestamptz, text) from public, anon;
grant execute on function public.trocar_acesso(uuid, text, uuid, timestamptz, text) to authenticated;
