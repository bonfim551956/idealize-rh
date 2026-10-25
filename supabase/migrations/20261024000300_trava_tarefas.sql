-- =====================================================================
-- IDEALIZE RH 360º — Correção de segurança: trava de campos em tarefas
-- A política tarefas_editar deixava o responsável gravar qualquer linha
-- nova (mudar de loja, forjar origem/chave_dedup/criado_por/concluida_por).
-- Política RLS não enxerga OLD, então a regra fica num trigger.
-- =====================================================================

create or replace function privado.travar_tarefas()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_livres text[] := array['status', 'descricao', 'concluida_por', 'concluida_em', 'atualizado_em'];
  v_gestor boolean;
begin
  -- service_role e rotinas internas (sem usuário logado) seguem livres
  if auth.uid() is null then return new; end if;

  -- origem, chave e autoria nunca mudam via API (mesma regra do insert)
  if new.origem is distinct from old.origem
     or new.chave_dedup is distinct from old.chave_dedup
     or new.criado_por is distinct from old.criado_por
     or new.criado_em is distinct from old.criado_em then
    raise exception 'Origem, chave e autoria da tarefa não podem ser alteradas' using errcode = '42501';
  end if;

  -- gestor = tarefa.gerir na loja antiga E na nova
  v_gestor := (case when old.loja_id is null then privado.pode('tarefa.gerir')
                    else privado.pode('tarefa.gerir', old.loja_id) end)
          and (case when new.loja_id is null then privado.pode('tarefa.gerir')
                    else privado.pode('tarefa.gerir', new.loja_id) end);

  -- responsável sem tarefa.gerir: só status e descrição
  if not v_gestor and (to_jsonb(new) - v_livres) is distinct from (to_jsonb(old) - v_livres) then
    raise exception 'O responsável só pode alterar status e descrição da própria tarefa' using errcode = '42501';
  end if;

  -- conclusão registrada pelo servidor
  if new.status = 'concluida' and old.status is distinct from 'concluida' then
    new.concluida_por := auth.uid();
    new.concluida_em  := now();
  elsif new.status = 'concluida' then
    new.concluida_por := old.concluida_por;
    new.concluida_em  := old.concluida_em;
  else
    new.concluida_por := null;
    new.concluida_em  := null;
  end if;
  return new;
end $$;

-- nome depois de a_maiusculas e tarefas_atualizado (ordem alfabética dos triggers)
create trigger travar_campos before update on public.tarefas
  for each row execute function privado.travar_tarefas();
