// POST { documento_id, versao?, acao: "visualizar" | "download" }
// Autoriza pelo banco (JWT do usuário, acesso fica registrado) e devolve
// uma URL assinada válida por 60 segundos. Nunca existe link permanente.
import { clienteServico, clienteUsuario, cors, resposta } from "../_shared/comum.ts";

const VALIDADE_SEGUNDOS = 60;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return resposta(req, 405, { erro: "Método não permitido" });

  const usuario = clienteUsuario(req);
  const { data: auth, error: authErro } = await usuario.auth.getUser();
  if (authErro || !auth?.user) return resposta(req, 401, { erro: "Sessão inválida ou expirada" });

  let corpo: { documento_id?: string; versao?: number; acao?: string };
  try {
    corpo = await req.json();
  } catch {
    return resposta(req, 400, { erro: "JSON inválido" });
  }
  const acao = corpo.acao === "download" ? "download" : "visualizar";
  if (!corpo.documento_id) return resposta(req, 400, { erro: "Informe documento_id" });

  const { data, error } = await usuario.rpc("documento_autorizar_acesso", {
    p_documento: corpo.documento_id, p_versao: corpo.versao ?? null, p_acao: acao,
  });
  if (error) return resposta(req, 400, { erro: error.message });
  const arq = Array.isArray(data) ? data[0] : null;
  if (!arq) return resposta(req, 403, { erro: "Acesso negado a este documento" });

  const { data: assinada, error: urlErro } = await clienteServico().storage.from("documentos")
    .createSignedUrl(arq.storage_path, VALIDADE_SEGUNDOS, acao === "download" ? { download: arq.nome_arquivo } : undefined);
  if (urlErro || !assinada) return resposta(req, 502, { erro: "Não foi possível gerar o link" });

  return resposta(req, 200, { url: assinada.signedUrl, expira_em_segundos: VALIDADE_SEGUNDOS, tipo: arq.mime_type });
});
