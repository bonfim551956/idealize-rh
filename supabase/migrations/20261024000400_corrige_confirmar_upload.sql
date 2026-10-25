-- =====================================================================
-- IDEALIZE RH 360º — Correção: documento_confirmar_upload
-- =====================================================================
-- A função é executável por "authenticated" e pode ser chamada direto via
-- PostgREST, sem passar pela Edge Function. Antes desta correção ela:
--   * confirmava versões sem arquivo gravado no storage (hash/MIME do cliente);
--   * desarquivava documentos (status volta para "recebido");
--   * aceitava versão antiga depois de uma mais nova (rollback da versão atual).
-- Agora exige: documento não arquivado, versão mais nova que a atual e o
-- objeto presente no bucket "documentos" (gravado pela Edge Function com a
-- chave de serviço ANTES de chamar esta função).
-- =====================================================================

create or replace function public.documento_confirmar_upload(p_versao uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  select dv.*, d.categoria_id, d.loja_id, d.colaborador_id, d.nome as doc_nome,
         d.status as doc_status, d.versao_atual, c.nivel_sigilo
    into v
    from public.documento_versoes dv
    join public.documentos d on d.id = dv.documento_id
    join public.doc_categorias c on c.id = d.categoria_id
   where dv.id = p_versao
     for update of dv, d;   -- trava contra arquivamento/confirmação concorrentes
  if v.id is null then raise exception 'Versão não encontrada'; end if;
  if v.confirmado then raise exception 'Versão já confirmada'; end if;
  if v.enviado_por is distinct from auth.uid() then raise exception 'Somente quem iniciou o envio pode confirmá-lo' using errcode = '42501'; end if;
  if not privado.pode_documento('enviar', v.categoria_id, v.loja_id) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  -- documento arquivado não volta para "recebido" por aqui
  if v.doc_status = 'arquivado' then
    raise exception 'Documento arquivado não recebe novas versões';
  end if;
  -- versão reservada antes de outra já confirmada não pode virar a atual
  if v.versao <= v.versao_atual then
    raise exception 'Versão desatualizada: o documento já está na versão %', v.versao_atual;
  end if;
  -- o arquivo precisa existir no bucket privado (gravado pela Edge Function)
  if not exists (select 1 from storage.objects o
                  where o.bucket_id = 'documentos' and o.name = v.storage_path) then
    raise exception 'Arquivo não encontrado no armazenamento; envie novamente';
  end if;

  update public.documento_versoes set confirmado = true where id = p_versao;
  perform set_config('idealize.via_funcao', 'documento', true);
  -- nova versão volta para "recebido": precisa de nova conferência
  update public.documentos
     set versao_atual = v.versao, status = 'recebido', conferido_por = null, conferido_em = null,
         enviado_por = auth.uid()
   where id = v.documento_id;
  perform set_config('idealize.via_funcao', '', true);

  if v.colaborador_id is not null then
    perform privado.timeline(v.colaborador_id, null, 'documento', current_date,
      case when v.versao = 1 then 'Documento recebido: ' else 'Nova versão (v' || v.versao || '): ' end || v.doc_nome,
      null, v.nivel_sigilo, v.documento_id);
  end if;
end $$;

revoke all on function public.documento_confirmar_upload(uuid) from public, anon;
grant execute on function public.documento_confirmar_upload(uuid) to authenticated;
