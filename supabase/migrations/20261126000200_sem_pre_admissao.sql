-- Fim da etapa "pré-admissão": quem ainda vai começar entra como "em admissão".
-- (O valor continua no tipo do banco só para o histórico antigo; ninguém mais entra nele.)

-- ninguém volta para pré-admissão; quem ainda está nela segue o caminho normal (em admissão ou arquivar)
delete from public.status_transicoes where para = 'pre_admissao';

do $$
declare d text; n int;
  t text[] := array[
    'coalesce(privado.texto(p, ''status_inicial''), ''pre_admissao'')::public.vinculo_status',
    'case when coalesce(privado.texto(p, ''status_inicial''), ''em_admissao'') in (''pre_admissao'', ''em_admissao'') then ''em_admissao'' else privado.texto(p, ''status_inicial'') end::public.vinculo_status',
    'if v_status not in (''pre_admissao'', ''ativo'') then',
    'if v_status not in (''em_admissao'', ''ativo'') then',
    'Status inicial deve ser pre_admissao ou ativo',
    'Status inicial deve ser em_admissao ou ativo'];
begin
  d := pg_get_functiondef('public.cadastrar_colaborador(jsonb)'::regprocedure);
  for i in 1..array_length(t, 1) by 2 loop
    n := (length(d) - length(replace(d, t[i], ''))) / length(t[i]);
    if n <> 1 then raise exception 'cadastrar_colaborador mudou: trecho não encontrado: %', t[i]; end if;
    d := replace(d, t[i], t[i+1]);
  end loop;
  execute d;
end $$;

-- Ninguém mais grava "pré-admissão"
create or replace function privado.bloquear_pre_admissao() returns trigger language plpgsql as $$
begin
  if new.status = 'pre_admissao' then
    raise exception 'A etapa "pré-admissão" não existe mais: use "em admissão"';
  end if;
  return new;
end $$;
drop trigger if exists a_sem_pre_admissao on public.vinculos;
create trigger a_sem_pre_admissao before insert or update of status on public.vinculos
  for each row execute function privado.bloquear_pre_admissao();
