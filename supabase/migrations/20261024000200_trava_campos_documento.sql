-- =====================================================================
-- Correção de segurança: trava de campos de integridade do documento
-- ---------------------------------------------------------------------
-- A política documentos_editar libera UPDATE direto (PostgREST) para quem
-- tem documento.<sigilo>.enviar. O trigger travava só status, conferente,
-- versão, loja, colaborador e categoria; quem envia conseguia reescrever
-- autoria (enviado_por, criado_por, criado_em), data da conferência
-- (conferido_em) e o status da assinatura de um documento JÁ APROVADO.
-- Agora esses campos também só mudam pelas funções próprias
-- (idealize.via_funcao = 'documento'). Nome, observações e datas
-- (emissão, recebimento, competência, período, vencimento) continuam
-- livres, como antes.
-- =====================================================================

create or replace function privado.travar_documento()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('idealize.via_funcao', true), '') <> 'documento' then
    if new.id is distinct from old.id
       or new.status is distinct from old.status
       or new.conferido_por is distinct from old.conferido_por
       or new.conferido_em is distinct from old.conferido_em
       or new.versao_atual is distinct from old.versao_atual
       or new.loja_id is distinct from old.loja_id
       or new.colaborador_id is distinct from old.colaborador_id
       or new.categoria_id is distinct from old.categoria_id
       or new.status_assinatura is distinct from old.status_assinatura
       or new.enviado_por is distinct from old.enviado_por
       or new.criado_por is distinct from old.criado_por
       or new.criado_em is distinct from old.criado_em then
      raise exception 'Status, assinatura, autoria, conferência, versão, loja, colaborador e categoria do documento só mudam pelas funções próprias'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
-- o trigger documentos_trava (migração 006) já aponta para esta função;
-- create or replace mantém a ligação.
