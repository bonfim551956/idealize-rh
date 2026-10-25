import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

export type Permissao = { permissao: string; loja_id: string | null; exige_mfa: boolean; liberada_na_sessao: boolean };
export type EstadoMfa = "ok" | "cadastrar" | "verificar";

type Ctx = {
  carregando: boolean;
  sessao: Session | null;
  nome: string;
  permissoes: Permissao[];
  mfa: EstadoMfa;
  temFatorMfa: boolean;
  /** a conta exige verificação em duas etapas */
  mfaObrigatorio: boolean;
  /** Tem a permissão (em alguma loja, ou na loja informada). Só para a interface — o servidor valida de novo. */
  pode: (perm: string, loja?: string | null) => boolean;
  /** null = todas as lojas; array = só estas lojas */
  lojasCom: (perm: string) => string[] | null;
  recarregar: () => Promise<void>;
  sair: () => Promise<void>;
};

const AuthCtx = createContext<Ctx | null>(null);
const INATIVIDADE_MS = 20 * 60 * 1000; // encerra a sessão após 20 min sem uso
const CHAVE_ATIVIDADE = "rh360.ultimaAtividade";
function registrarAtividade(t: number) {
  try { localStorage.setItem(CHAVE_ATIVIDADE, String(t)); } catch { /* armazenamento indisponível */ }
}
function limparAtividade() {
  try { localStorage.removeItem(CHAVE_ATIVIDADE); } catch { /* armazenamento indisponível */ }
}
/** true quando a última atividade registrada passou do limite (sem registro = não encerra) */
function inativoDemais(): boolean {
  try {
    const t = Number(localStorage.getItem(CHAVE_ATIVIDADE));
    return Number.isFinite(t) && t > 0 && Date.now() - t > INATIVIDADE_MS;
  } catch { return false; }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [carregando, setCarregando] = useState(true);
  const [sessao, setSessao] = useState<Session | null>(null);
  const [permissoes, setPermissoes] = useState<Permissao[]>([]);
  const [mfa, setMfa] = useState<EstadoMfa>("ok");
  const [temFatorMfa, setTemFatorMfa] = useState(false);
  const [mfaObrigatorio, setMfaObrigatorio] = useState(false);
  const [nome, setNome] = useState("");

  const carregarContexto = useCallback(async (s: Session | null) => {
    if (!s) {
      setPermissoes([]); setMfa("ok"); setTemFatorMfa(false); setNome("");
      return;
    }
    const [perms, aal, fatores, perfil] = await Promise.all([
      supabase.rpc("minhas_permissoes"),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
      supabase.from("usuarios").select("nome,mfa_obrigatorio").eq("id", s.user.id).maybeSingle(),
    ]);
    const lista = (perms.data ?? []) as Permissao[];
    setPermissoes(lista);
    setNome(perfil.data?.nome ?? s.user.email ?? "");
    const verificados = (fatores.data?.totp ?? []).filter((f) => f.status === "verified");
    setTemFatorMfa(verificados.length > 0);
    // MFA é exigido por usuário (usuarios.mfa_obrigatorio); sem a exigência, entra só com senha
    const obrigatorio = perfil.data?.mfa_obrigatorio ?? true;
    setMfaObrigatorio(obrigatorio);
    if (!obrigatorio) setMfa("ok");
    else if (aal.data?.currentLevel === "aal1" && aal.data?.nextLevel === "aal2") setMfa("verificar");
    else if (verificados.length === 0) setMfa("cadastrar");
    else setMfa("ok");
  }, []);

  useEffect(() => {
    let ativo = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!ativo) return;
      // sessão guardada de uma aba fechada há mais de 20 min: encerra antes de abrir
      if (data.session && inativoDemais()) {
        await supabase.auth.signOut({ scope: "local" });
        limparAtividade();
        setSessao(null);
        await carregarContexto(null);
        setCarregando(false);
        return;
      }
      setSessao(data.session);
      await carregarContexto(data.session);
      setCarregando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((evento, s) => {
      setSessao(s);
      if (evento === "SIGNED_OUT") { carregarContexto(null); return; }
      if (evento === "SIGNED_IN" || evento === "MFA_CHALLENGE_VERIFIED" || evento === "USER_UPDATED") {
        // fora do callback para não travar o cliente de auth
        setTimeout(() => carregarContexto(s), 0);
      }
    });
    return () => { ativo = false; sub.subscription.unsubscribe(); };
  }, [carregarContexto]);

  // Encerramento por inatividade
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!sessao) return;
    // a última atividade fica gravada (vale para todas as abas e sobrevive ao fechar o navegador)
    let ultimaGravacao = 0;
    const reiniciar = () => {
      const agora = Date.now();
      if (agora - ultimaGravacao > 15_000) { ultimaGravacao = agora; registrarAtividade(agora); }
    };
    const verificar = () => {
      if (inativoDemais()) { limparAtividade(); supabase.auth.signOut(); }
    };
    const eventos = ["mousedown", "keydown", "touchstart", "scroll"] as const;
    eventos.forEach((e) => window.addEventListener(e, reiniciar, { passive: true }));
    registrarAtividade(Date.now());
    timer.current = window.setInterval(verificar, 30_000);
    document.addEventListener("visibilitychange", verificar);
    return () => {
      window.clearInterval(timer.current);
      document.removeEventListener("visibilitychange", verificar);
      eventos.forEach((e) => window.removeEventListener(e, reiniciar));
    };
  }, [sessao]);

  const valor = useMemo<Ctx>(() => ({
    carregando, sessao, nome, permissoes, mfa, temFatorMfa, mfaObrigatorio,
    pode: (perm, loja) =>
      permissoes.some((p) => p.permissao === perm && p.liberada_na_sessao &&
        (loja === undefined || p.loja_id === null || p.loja_id === loja)),
    lojasCom: (perm) => {
      const ps = permissoes.filter((p) => p.permissao === perm && p.liberada_na_sessao);
      if (ps.some((p) => p.loja_id === null)) return null;
      return ps.map((p) => p.loja_id!) ;
    },
    recarregar: () => carregarContexto(sessao),
    sair: async () => { limparAtividade(); await supabase.auth.signOut(); },
  }), [carregando, sessao, nome, permissoes, mfa, temFatorMfa, mfaObrigatorio, carregarContexto]);

  return <AuthCtx.Provider value={valor}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const c = useContext(AuthCtx);
  if (!c) throw new Error("useAuth fora do AuthProvider");
  return c;
}
