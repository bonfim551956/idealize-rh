// Idealize RH aberto dentro do Central Idealize (login único).
// O Central e o RH usam o mesmo login (este projeto). Dentro do Central, o RH não guarda sessão própria:
// recebe do Central só o token de acesso (nunca o de renovação) e, quando o Central renova, recebe o novo.
// Fora do Central, nada muda.
export const CENTRAL = "https://central.oticasidealize.online";
export const ORIGENS_CENTRAL = ["https://central.oticasidealize.online", "https://central-idealize.vercel.app"];

export const embutidoNoCentral = (() => {
  try { return window.self !== window.top; } catch { return true; }
})();

const deCentral = (e: MessageEvent) => ORIGENS_CENTRAL.includes(e.origin) && e.source === window.parent;

/** Avisa o Central que o RH está pronto e passa a ouvir o token e o pedido de saída. */
export function conectarAoCentral(aoReceberToken: (token: string) => void, aoSair: () => void): () => void {
  if (!embutidoNoCentral) return () => {};
  const ouvir = (e: MessageEvent) => {
    if (!deCentral(e)) return;
    if (e.data?.tipo === "central:token" && typeof e.data.token === "string") aoReceberToken(e.data.token);
    if (e.data?.tipo === "central:sair") aoSair();
  };
  window.addEventListener("message", ouvir);
  window.parent.postMessage({ tipo: "central:pronto", sistema: "rh" }, "*");
  return () => window.removeEventListener("message", ouvir);
}

/** Pede ao Central para encerrar a sessão (o Central encerra em todos os sistemas). */
export function pedirSaidaAoCentral() {
  if (embutidoNoCentral) window.parent.postMessage({ tipo: "central:sair-pedido" }, "*");
}

// Uso dentro do RH conta como atividade no Central (o Central encerra após 20 min sem uso)
if (embutidoNoCentral) {
  let ultimo = 0;
  const avisar = () => {
    const t = Date.now();
    if (t - ultimo > 30000) { ultimo = t; window.parent.postMessage({ tipo: "central:atividade" }, "*"); }
  };
  (["mousedown", "keydown", "touchstart", "scroll"] as const).forEach((e) => window.addEventListener(e, avisar, { passive: true }));
}
