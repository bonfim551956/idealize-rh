// Convite pelo Central Idealize (mesma regra do usuarios-convidar do RH):
// POST { email, nome }                → convida uma nova pessoa (o link leva à tela de criar senha do Central)
// POST { reenviar: true, usuario_id } → reenvia o convite de quem ainda não ativou a conta
// Só quem tem 'acesso.gerir' em TODAS as lojas, com MFA ativo na sessão, convida.
// A pessoa entra SEM nenhum sistema: a diretoria libera depois na Gestão de acessos (auditado).
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGENS = ["https://central.oticasidealize.online", "https://central-idealize.vercel.app"];
const SITE_PADRAO = ORIGENS[0];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGENS.includes(o) ? o : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const resposta = (req: Request, status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return resposta(req, 405, { erro: "Método não permitido" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const usuario = createClient(url, anon, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: auth, error: authErro } = await usuario.auth.getUser();
  if (authErro || !auth?.user) return resposta(req, 401, { erro: "Sessão inválida ou expirada" });

  const { data: gestor, error: gErro } = await usuario.rpc("central_sou_gestor");
  if (gErro) return resposta(req, 400, { erro: gErro.message });
  if (!gestor) return resposta(req, 403, { erro: "Sem permissão para convidar (exige verificação em duas etapas)" });

  let corpo: { email?: string; nome?: string; reenviar?: boolean; usuario_id?: string };
  try { corpo = await req.json(); } catch { return resposta(req, 400, { erro: "JSON inválido" }); }

  const origem = req.headers.get("origin") ?? "";
  const redirectTo = `${ORIGENS.includes(origem) ? origem : SITE_PADRAO}/definir-senha`;
  const servico = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  if (corpo.reenviar) {
    if (!corpo.usuario_id || !UUID_RE.test(corpo.usuario_id)) return resposta(req, 400, { erro: "Usuário inválido" });
    const { data: alvo, error: alvoErro } = await servico.auth.admin.getUserById(corpo.usuario_id);
    if (alvoErro || !alvo?.user?.email) return resposta(req, 404, { erro: "Usuário não encontrado" });
    const u = alvo.user;
    if (u.email_confirmed_at || u.last_sign_in_at) {
      return resposta(req, 409, { erro: "Esta pessoa já ativou a conta. Se esqueceu a senha, use “Esqueci minha senha” na tela de login." });
    }
    const { error } = await servico.auth.admin.inviteUserByEmail(u.email!, {
      data: { nome: (u.user_metadata as { nome?: string } | undefined)?.nome ?? "" },
      redirectTo,
    });
    if (error) {
      const publico = createClient(url, anon, { auth: { persistSession: false } });
      const { error: recErro } = await publico.auth.resetPasswordForEmail(u.email!, { redirectTo });
      if (recErro) {
        console.error("central_reenvio", { usuario: u.id, convite: error.message, recuperacao: recErro.message });
        const limite = /rate|limit|seconds/i.test(recErro.message);
        return resposta(req, limite ? 429 : 400, {
          erro: limite ? "Muitos e-mails enviados agora. Aguarde alguns minutos e tente de novo." : "Não foi possível reenviar o convite.",
        });
      }
    }
    return resposta(req, 200, { usuario_id: u.id, reenviado: true });
  }

  const email = (corpo.email ?? "").trim().toLowerCase();
  const nome = (corpo.nome ?? "").trim();
  if (!EMAIL_RE.test(email)) return resposta(req, 400, { erro: "E-mail inválido" });
  if (nome.length < 2) return resposta(req, 400, { erro: "Informe o nome" });
  const { data, error } = await servico.auth.admin.inviteUserByEmail(email, { data: { nome }, redirectTo });
  if (error) {
    const jaExiste = /already|registered|exists/i.test(error.message);
    const limite = /rate|limit|seconds/i.test(error.message);
    return resposta(req, jaExiste ? 409 : limite ? 429 : 400, {
      erro: jaExiste ? "Já existe um acesso com este e-mail" : limite ? "Muitos e-mails enviados agora. Aguarde alguns minutos e tente de novo." : error.message,
    });
  }
  return resposta(req, 201, { usuario_id: data.user?.id, email });
});
