// POST { email, nome }                 → convida um novo usuário
// POST { reenviar: true, usuario_id }  → reenvia o convite de quem ainda não ativou a conta
// Só quem tem a permissão 'acesso.gerir' em TODAS as lojas (com MFA ativo na sessão) convida.
// O convidado recebe e-mail para definir a senha e entra SEM nenhum acesso:
// os perfis são concedidos depois, no próprio sistema (auditado).
import { createClient } from "npm:@supabase/supabase-js@2";
import { clienteServico, clienteUsuario, cors, resposta } from "../_shared/comum.ts";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return resposta(req, 405, { erro: "Método não permitido" });

  const usuario = clienteUsuario(req);
  const { data: auth, error: authErro } = await usuario.auth.getUser();
  if (authErro || !auth?.user) return resposta(req, 401, { erro: "Sessão inválida ou expirada" });

  const { data: perms, error: permErro } = await usuario.rpc("minhas_permissoes");
  if (permErro) return resposta(req, 400, { erro: permErro.message });
  // mesma regra do banco: acesso.gerir só vale quando é para todas as lojas
  const pode = (perms ?? []).some(
    (p: { permissao: string; loja_id: string | null; liberada_na_sessao: boolean }) =>
      p.permissao === "acesso.gerir" && p.loja_id === null && p.liberada_na_sessao,
  );
  if (!pode) return resposta(req, 403, { erro: "Sem permissão para convidar usuários (exige MFA)" });

  let corpo: { email?: string; nome?: string; reenviar?: boolean; usuario_id?: string };
  try {
    corpo = await req.json();
  } catch {
    return resposta(req, 400, { erro: "JSON inválido" });
  }
  const site = Deno.env.get("SITE_URL") ?? req.headers.get("origin") ?? "";
  const redirectTo = site ? `${site}/definir-senha` : undefined;
  const servico = clienteServico();

  // ---- Reenviar convite ------------------------------------------------
  if (corpo.reenviar) {
    if (!corpo.usuario_id || !UUID_RE.test(corpo.usuario_id)) return resposta(req, 400, { erro: "Usuário inválido" });
    const { data: alvo, error: alvoErro } = await servico.auth.admin.getUserById(corpo.usuario_id);
    if (alvoErro || !alvo?.user?.email) return resposta(req, 404, { erro: "Usuário não encontrado" });
    const u = alvo.user;
    if (u.email_confirmed_at || u.last_sign_in_at) {
      return resposta(req, 409, { erro: "Esta pessoa já ativou a conta. Se esqueceu a senha, use “Esqueci minha senha” na tela de login." });
    }
    // convite de novo (o Supabase reaproveita o cadastro ainda não confirmado)
    const { error } = await servico.auth.admin.inviteUserByEmail(u.email!, {
      data: { nome: (u.user_metadata as { nome?: string } | undefined)?.nome ?? "" },
      redirectTo,
    });
    if (error) {
      // alternativa: link de definição de senha, que também ativa a conta
      const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        auth: { persistSession: false },
      });
      const { error: recErro } = await anon.auth.resetPasswordForEmail(u.email!, { redirectTo });
      if (recErro) {
        console.error("reenvio_convite", { usuario: u.id, convite: error.message, recuperacao: recErro.message });
        const limite = /rate|limit|seconds/i.test(recErro.message);
        return resposta(req, limite ? 429 : 400, {
          erro: limite ? "Muitos e-mails enviados agora. Aguarde alguns minutos e tente de novo." : "Não foi possível reenviar o convite.",
        });
      }
    }
    return resposta(req, 200, { usuario_id: u.id, email: u.email, reenviado: true });
  }

  // ---- Novo convite ----------------------------------------------------
  const email = (corpo.email ?? "").trim().toLowerCase();
  const nome = (corpo.nome ?? "").trim();
  if (!EMAIL_RE.test(email)) return resposta(req, 400, { erro: "E-mail inválido" });
  if (nome.length < 2) return resposta(req, 400, { erro: "Informe o nome" });

  const { data, error } = await servico.auth.admin.inviteUserByEmail(email, { data: { nome }, redirectTo });
  if (error) {
    const jaExiste = /already|registered|exists/i.test(error.message);
    return resposta(req, jaExiste ? 409 : 400, {
      erro: jaExiste ? "Já existe um usuário com este e-mail" : error.message,
    });
  }
  return resposta(req, 201, { usuario_id: data.user?.id, email });
});
