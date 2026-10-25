// POST multipart/form-data
//   arquivo       (obrigatório)  PDF, JPG, PNG ou WEBP até 20 MB
//   meta          (JSON)         { nome, categoria_id, colaborador_id?, loja_id?, data_emissao?, competencia?, vencimento?, ... }
//   documento_id  (opcional)     envia nova versão de um documento existente
//   motivo        (obrigatório em nova versão)
//
// Fluxo: valida arquivo → documento_preparar_upload (JWT do usuário, checa permissão)
//        → grava no bucket privado (chave de serviço) → documento_confirmar_upload (JWT do usuário)
import {
  clienteServico, clienteUsuario, cors, detectarTipo, nomeComExtensao, pdfSuspeito, resposta, sha256, TAMANHO_MAXIMO,
} from "../_shared/comum.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return resposta(req, 405, { erro: "Método não permitido" });

  const usuario = clienteUsuario(req);
  const { data: auth, error: authErro } = await usuario.auth.getUser();
  if (authErro || !auth?.user) return resposta(req, 401, { erro: "Sessão inválida ou expirada" });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return resposta(req, 400, { erro: "Envie o arquivo como multipart/form-data" });
  }

  const arquivo = form.get("arquivo");
  if (!(arquivo instanceof File)) return resposta(req, 400, { erro: "Arquivo não enviado" });
  if (arquivo.size === 0) return resposta(req, 400, { erro: "Arquivo vazio" });
  if (arquivo.size > TAMANHO_MAXIMO) return resposta(req, 413, { erro: "Arquivo maior que 20 MB" });

  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const tipo = detectarTipo(bytes);
  if (!tipo) return resposta(req, 415, { erro: "Tipo de arquivo não aceito. Use PDF, JPG, PNG ou WEBP." });
  if (tipo === "application/pdf" && pdfSuspeito(bytes)) {
    return resposta(req, 422, { erro: "PDF com conteúdo ativo (scripts/anexos) não é aceito. Gere o PDF novamente." });
  }

  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(String(form.get("meta") ?? "{}"));
  } catch {
    return resposta(req, 400, { erro: "Metadados inválidos" });
  }
  const documentoId = (form.get("documento_id") as string) || null;
  const motivo = (form.get("motivo") as string) || null;
  const hash = await sha256(bytes);
  // extensão sempre do tipo detectado pelo conteúdo (evita holerite.hta com cabeçalho de JPEG)
  const nomeArquivo = nomeComExtensao(arquivo.name, tipo);

  // 1) Autoriza e reserva a versão (RLS + permissão por sigilo e loja)
  const { data: prep, error: prepErro } = await usuario.rpc("documento_preparar_upload", {
    p_documento: documentoId, p_meta: meta, p_nome_arquivo: nomeArquivo,
    p_mime: tipo, p_tamanho: bytes.length, p_sha256: hash, p_motivo: motivo,
  });
  if (prepErro) return resposta(req, 400, { erro: prepErro.message });
  const reserva = Array.isArray(prep) ? prep[0] : null;
  if (!reserva) return resposta(req, 403, { erro: "Sem permissão para enviar este documento" });

  // 2) Grava no bucket privado
  const { error: upErro } = await clienteServico().storage.from("documentos")
    .upload(reserva.storage_path, bytes, { contentType: tipo, upsert: false });
  if (upErro) {
    console.error("falha_storage", { versao: reserva.versao_id, msg: upErro.message });
    return resposta(req, 502, { erro: "Falha ao gravar o arquivo. Tente novamente." });
  }

  // 3) Confirma: documento passa a "recebido" (ainda precisa de conferência)
  const { error: confErro } = await usuario.rpc("documento_confirmar_upload", { p_versao: reserva.versao_id });
  if (confErro) {
    await clienteServico().storage.from("documentos").remove([reserva.storage_path]);
    return resposta(req, 400, { erro: confErro.message });
  }

  return resposta(req, 201, {
    documento_id: reserva.documento_id, versao: reserva.versao, status: "recebido", sha256: hash, tipo,
  });
});
