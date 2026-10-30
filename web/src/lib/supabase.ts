import { createClient } from "@supabase/supabase-js";
import { embutidoNoCentral } from "./central";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const chave = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!url || !chave) {
  throw new Error("Configuração ausente: defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY.");
}

// Dentro do Central Idealize a sessão vem do Central (só em memória, sem renovação própria)
export const supabase = createClient(url, chave, {
  auth: embutidoNoCentral
    ? { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    : { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const SUPABASE_URL = url;

/** Chama uma Edge Function com o token da sessão. Lança erro com a mensagem do servidor. */
export async function chamarFuncao<T>(nome: string, corpo: BodyInit, json = true): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sessão expirada. Entre novamente.");
  const resp = await fetch(`${url}/functions/v1/${nome}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: chave!,
      ...(json ? { "Content-Type": "application/json" } : {}),
    },
    body: corpo,
  });
  const texto = await resp.text();
  let dados: unknown = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch { /* resposta não-JSON */ }
  if (!resp.ok) {
    const msg = (dados as { erro?: string } | null)?.erro ?? `Erro ${resp.status}`;
    throw new Error(msg);
  }
  return dados as T;
}

/** Converte erros do Postgres/PostgREST em mensagens legíveis. */
export function mensagemErro(e: unknown): string {
  if (!e) return "Erro desconhecido";
  const m = (e as { message?: string }).message ?? String(e);
  if (/permission denied|42501|Acesso negado/i.test(m)) return m.includes("Acesso negado") ? m : "Você não tem permissão para esta ação.";
  if (/duplicate key|23505/i.test(m)) return m.includes("CPF") ? m : "Registro duplicado.";
  if (/check constraint.*cpf/i.test(m)) return "CPF inválido.";
  if (/check constraint/i.test(m)) return "Algum campo está com valor inválido.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Sem conexão com o servidor. Verifique a internet.";
  return m;
}
