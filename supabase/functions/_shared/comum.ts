// Utilitários compartilhados das Edge Functions do Idealize RH 360º
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const ORIGENS_PERMITIDAS = (Deno.env.get("ORIGENS_PERMITIDAS") ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

export function cors(req: Request): Record<string, string> {
  const origem = req.headers.get("origin") ?? "";
  const permitida = ORIGENS_PERMITIDAS.length === 0 || ORIGENS_PERMITIDAS.includes(origem);
  return {
    "Access-Control-Allow-Origin": permitida ? origem || "*" : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function resposta(req: Request, status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json" },
  });
}

/** Cliente com o JWT do usuário: RLS e permissões valem normalmente. */
export function clienteUsuario(req: Request): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
}

/** Cliente de serviço: usado SOMENTE para o storage, depois da autorização. */
export function clienteServico(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

export const TAMANHO_MAXIMO = 20 * 1024 * 1024;

/** Detecta o tipo real pelo conteúdo (assinatura), ignorando extensão e o tipo informado pelo navegador. */
export function detectarTipo(b: Uint8Array): string | null {
  const ini = (...bytes: number[]) => bytes.every((v, i) => b[i] === v);
  if (ini(0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf";               // %PDF-
  if (ini(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (ini(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (ini(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return "image/webp";                                                          // RIFF....WEBP
  }
  return null;
}

/** Recusa PDFs com JavaScript embutido ou ações automáticas (vetor comum de ataque). */
export function pdfSuspeito(b: Uint8Array): boolean {
  const texto = new TextDecoder("latin1").decode(b);
  return /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction)\b/.test(texto);
}

export async function sha256(b: Uint8Array): Promise<string> {
  const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function nomeSeguro(nome: string): string {
  return nome.normalize("NFKC").replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 200) || "arquivo";
}
