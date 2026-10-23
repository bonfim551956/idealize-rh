// POST { email, nome }
// Só quem tem a permissão 'acesso.gerir' (com MFA ativo na sessão) convida usuários.
// O convidado recebe e-mail para definir a senha e entra SEM nenhum acesso:
// os perfis são concedidos depois, no próprio sistema (auditado).
import { clienteServico, clienteUsuario, cors, resposta } from "../_shared/comum.ts";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return resposta(req, 405, { erro: "Método não permitido" });

  const usuario = clienteUsuario(req);
  const { data: auth, error: authErro } = await usuario.auth.getUser();
  if (authErro || !auth?.user) return resposta(req, 401, { erro: "Sessão inválida ou expirada" });

  const { data: perms, error: permErro } = await usuario.rpc("minhas_permissoes");
  if (permErro) return resposta(req, 400, { erro: permErro.message });
  const pode = (perms ?? []).some(
    (p: { permissao: string; liberada_na_sessao: boolean }) => p.permissao === "acesso.gerir" && p.liberada_na_sessao,
  );
  if (!pode) return resposta(req, 403, { erro: "Sem permissão para convidar usuários (exige MFA)" });

  let corpo: { email?: string; nome?: string };
  try {
    corpo = await req.json();
  } catch {
    return resposta(req, 400, { erro: "JSON inválido" });
  }
  const email = (corpo.email ?? "").trim().toLowerCase();
  const nome = (corpo.nome ?? "").trim();
  if (!EMAIL_RE.test(email)) return resposta(req, 400, { erro: "E-mail inválido" });
  if (nome.length < 2) return resposta(req, 400, { erro: "Informe o nome" });

  const site = Deno.env.get("SITE_URL") ?? req.headers.get("origin") ?? "";
  const { data, error } = await clienteServico().auth.admin.inviteUserByEmail(email, {
    data: { nome },
    redirectTo: site ? `${site}/definir-senha` : undefined,
  });
  if (error) {
    const jaExiste = /already|registered|exists/i.test(error.message);
    return resposta(req, jaExiste ? 409 : 400, {
      erro: jaExiste ? "Já existe um usuário com este e-mail" : error.message,
    });
  }
  return resposta(req, 201, { usuario_id: data.user?.id, email });
});
