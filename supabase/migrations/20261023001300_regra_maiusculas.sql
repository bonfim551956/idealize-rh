-- =====================================================================
-- REGRA DE OURO: todo texto registrado fica em LETRA MAIÚSCULA.
-- Aplicada no banco (trigger BEFORE INSERT/UPDATE), então vale para
-- qualquer origem: telas, importações, integrações, SQL direto.
--
-- Ficam FORA (por necessidade técnica, não são texto digitado):
--   * e-mail de LOGIN (public.usuarios.email) — o Supabase Auth exige minúsculo
--   * códigos internos (codigo de categoria/perfil, códigos de permissão,
--     status/enums, modalidade de desligamento) — usados pelo sistema
--   * caminho de arquivo no storage, hash SHA-256, tipo MIME
--   * JSON da auditoria (cópia fiel do registro)
-- =====================================================================

create or replace function privado.maiusculas()
returns trigger language plpgsql set search_path = '' as $$
declare
  j jsonb := to_jsonb(new);
  c text;
begin
  foreach c in array tg_argv loop
    if jsonb_typeof(j -> c) = 'string' then
      j := jsonb_set(j, array[c], to_jsonb(upper(j ->> c)));
    end if;
  end loop;
  new := jsonb_populate_record(new, j);
  return new;
end $$;

-- "a_" no nome: triggers BEFORE rodam em ordem alfabética; esta roda primeiro
create trigger a_maiusculas before insert or update on public.empresas
  for each row execute function privado.maiusculas('razao_social', 'nome_fantasia', 'observacao');
create trigger a_maiusculas before insert or update on public.lojas
  for each row execute function privado.maiusculas('codigo', 'nome', 'cidade', 'uf', 'endereco', 'observacao');
create trigger a_maiusculas before insert or update on public.departamentos
  for each row execute function privado.maiusculas('nome');
create trigger a_maiusculas before insert or update on public.cargos
  for each row execute function privado.maiusculas('nome', 'descricao');
create trigger a_maiusculas before insert or update on public.usuarios
  for each row execute function privado.maiusculas('nome');
create trigger a_maiusculas before insert or update on public.perfis
  for each row execute function privado.maiusculas('nome', 'descricao');
create trigger a_maiusculas before insert or update on public.permissoes
  for each row execute function privado.maiusculas('descricao');
create trigger a_maiusculas before insert or update on public.usuario_atribuicoes
  for each row execute function privado.maiusculas('motivo');
create trigger a_maiusculas before insert or update on public.colaboradores
  for each row execute function privado.maiusculas('nome_completo', 'nome_social', 'email', 'logradouro', 'numero',
    'complemento', 'bairro', 'cidade', 'uf');
create trigger a_maiusculas before insert or update on public.contatos_emergencia
  for each row execute function privado.maiusculas('nome', 'parentesco');
create trigger a_maiusculas before insert or update on public.vinculos
  for each row execute function privado.maiusculas('matricula', 'escala');
create trigger a_maiusculas before insert or update on public.vinculo_status_historico
  for each row execute function privado.maiusculas('motivo');
create trigger a_maiusculas before insert or update on public.desligamentos
  for each row execute function privado.maiusculas('observacoes');
create trigger a_maiusculas before insert or update on public.lotacoes
  for each row execute function privado.maiusculas('motivo');
create trigger a_maiusculas before insert or update on public.historico_cargos
  for each row execute function privado.maiusculas('motivo');
create trigger a_maiusculas before insert or update on public.remuneracoes
  for each row execute function privado.maiusculas('motivo');
create trigger a_maiusculas before insert or update on public.eventos_timeline
  for each row execute function privado.maiusculas('titulo', 'descricao');
create trigger a_maiusculas before insert or update on public.tarefas
  for each row execute function privado.maiusculas('titulo', 'descricao');
create trigger a_maiusculas before insert or update on public.doc_categorias
  for each row execute function privado.maiusculas('nome', 'retencao_observacao');
create trigger a_maiusculas before insert or update on public.documentos
  for each row execute function privado.maiusculas('nome', 'observacoes');
create trigger a_maiusculas before insert or update on public.documento_versoes
  for each row execute function privado.maiusculas('nome_arquivo_original', 'motivo_substituicao');

-- Converte o que já existe (o próprio trigger faz a conversão)
update public.empresas set razao_social = razao_social;
update public.lojas set nome = nome;
update public.departamentos set nome = nome;
update public.cargos set nome = nome;
update public.usuarios set nome = nome;
update public.perfis set nome = nome;
update public.permissoes set descricao = descricao;
update public.usuario_atribuicoes set motivo = motivo;
update public.doc_categorias set nome = nome;
update public.colaboradores set nome_completo = nome_completo;
update public.contatos_emergencia set nome = nome;
update public.vinculos set matricula = matricula;
update public.vinculo_status_historico set motivo = motivo;
update public.desligamentos set observacoes = observacoes;
update public.lotacoes set motivo = motivo;
update public.historico_cargos set motivo = motivo;
update public.remuneracoes set motivo = motivo;
update public.eventos_timeline set titulo = titulo;
update public.tarefas set titulo = titulo;
update public.documentos set nome = nome;
update public.documento_versoes set nome_arquivo_original = nome_arquivo_original;
