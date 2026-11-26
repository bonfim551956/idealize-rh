-- Sem etapas antes do "ativo": cadastro sempre nasce ativo (com data de admissão).
-- Quem estava em pré-admissão / em admissão passa a ativo, com registro no histórico.

do $$
declare d text := pg_get_functiondef('public.cadastrar_colaborador(jsonb)'::regprocedure); n int;
  de text := 'case when coalesce(privado.texto(p, ''status_inicial''), ''em_admissao'') in (''pre_admissao'', ''em_admissao'') then ''em_admissao'' else privado.texto(p, ''status_inicial'') end::public.vinculo_status';
begin
  n := (length(d) - length(replace(d, de, ''))) / length(de);
  if n <> 1 then raise exception 'cadastrar_colaborador mudou: status inicial não encontrado'; end if;
  execute replace(d, de, '''ativo''::public.vinculo_status');
end $$;

-- move quem está antes de "ativo"
do $$
declare r record;
begin
  perform set_config('idealize.via_funcao', 'status', true);
  for r in select v.id, v.colaborador_id, v.status, v.data_admissao from public.vinculos v where v.status in ('pre_admissao', 'em_admissao') loop
    update public.vinculos set status = 'ativo' where id = r.id;
    insert into public.vinculo_status_historico (vinculo_id, de, para, motivo, data_efeito)
      values (r.id, r.status, 'ativo', 'FIM DAS ETAPAS DE PRÉ-ADMISSÃO / EM ADMISSÃO', coalesce(r.data_admissao, current_date));
    perform privado.timeline(r.colaborador_id, r.id, 'status', coalesce(r.data_admissao, current_date),
      'STATUS: ' || upper(replace(r.status::text, '_', ' ')) || ' → ATIVO', 'FIM DAS ETAPAS DE PRÉ-ADMISSÃO / EM ADMISSÃO', 'geral');
  end loop;
  perform set_config('idealize.via_funcao', '', true);
end $$;

delete from public.status_transicoes where de in ('pre_admissao', 'em_admissao') or para in ('pre_admissao', 'em_admissao');

create or replace function privado.bloquear_pre_admissao() returns trigger language plpgsql as $$
begin
  if new.status in ('pre_admissao', 'em_admissao') then
    raise exception 'Não há mais etapas antes de "ativo": cadastre o colaborador como ativo, com a data de admissão';
  end if;
  return new;
end $$;
