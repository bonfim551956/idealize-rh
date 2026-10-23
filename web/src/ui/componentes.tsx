import { createContext, forwardRef, useCallback, useContext, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Inbox, Loader2, X, XCircle } from "lucide-react";
import type { Tom } from "../lib/formato";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/* ---------------- Botão ---------------- */
type Variante = "primaria" | "secundaria" | "perigo" | "fantasma";
const estilosBotao: Record<Variante, string> = {
  primaria: "bg-primaria text-superficie hover:bg-primaria-escura active:bg-primaria-escura",
  secundaria: "bg-superficie text-texto border border-borda hover:bg-fundo active:bg-borda",
  perigo: "bg-perigo text-superficie hover:opacity-90 active:opacity-80",
  fantasma: "text-primaria hover:bg-primaria-suave active:bg-primaria-suave",
};

export const Botao = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: Variante; carregando?: boolean; icone?: ReactNode; tamanho?: "md" | "sm";
}>(function Botao({ variante = "primaria", carregando, icone, tamanho = "md", className, children, disabled, ...p }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        tamanho === "md" ? "h-10 px-4 text-sm" : "h-8 px-3 text-xs",
        estilosBotao[variante], className,
      )}
      {...p}
    >
      {carregando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icone}
      {children}
    </button>
  );
});

/* ---------------- Campos ---------------- */
type CampoBase = { rotulo: string; erro?: string | null; dica?: string; obrigatorio?: boolean };

function Rotulo({ id, rotulo, obrigatorio }: { id: string; rotulo: string; obrigatorio?: boolean }) {
  return (
    <label htmlFor={id} className="mb-1 block text-sm font-medium text-texto">
      {rotulo}{obrigatorio && <span className="text-perigo" aria-hidden> *</span>}
    </label>
  );
}
function Rodape({ id, erro, dica }: { id: string; erro?: string | null; dica?: string }) {
  if (erro) return <p id={`${id}-msg`} className="mt-1 text-xs text-perigo" role="alert">{erro}</p>;
  if (dica) return <p id={`${id}-msg`} className="mt-1 text-xs text-texto-suave">{dica}</p>;
  return null;
}
const baseCampo = "w-full rounded-lg border bg-superficie px-3 text-sm text-texto placeholder:text-texto-suave/70 disabled:bg-fundo disabled:text-texto-suave";

export const Campo = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & CampoBase>(
  function Campo({ rotulo, erro, dica, obrigatorio, id, className, ...p }, ref) {
    const i = id ?? `c-${rotulo.replace(/\W/g, "")}`;
    return (
      <div className={className}>
        <Rotulo id={i} rotulo={rotulo} obrigatorio={obrigatorio} />
        <input ref={ref} id={i} required={obrigatorio} aria-invalid={!!erro} aria-describedby={erro || dica ? `${i}-msg` : undefined}
          className={cx(baseCampo, "h-10", erro ? "border-perigo" : "border-borda")} {...p} />
        <Rodape id={i} erro={erro} dica={dica} />
      </div>
    );
  });

export function Selecao({ rotulo, erro, dica, obrigatorio, id, className, children, ...p }:
  SelectHTMLAttributes<HTMLSelectElement> & CampoBase) {
  const i = id ?? `s-${rotulo.replace(/\W/g, "")}`;
  return (
    <div className={className}>
      <Rotulo id={i} rotulo={rotulo} obrigatorio={obrigatorio} />
      <select id={i} required={obrigatorio} aria-invalid={!!erro}
        className={cx(baseCampo, "h-10", erro ? "border-perigo" : "border-borda")} {...p}>{children}</select>
      <Rodape id={i} erro={erro} dica={dica} />
    </div>
  );
}

export function AreaTexto({ rotulo, erro, dica, obrigatorio, id, className, ...p }:
  TextareaHTMLAttributes<HTMLTextAreaElement> & CampoBase) {
  const i = id ?? `t-${rotulo.replace(/\W/g, "")}`;
  return (
    <div className={className}>
      <Rotulo id={i} rotulo={rotulo} obrigatorio={obrigatorio} />
      <textarea id={i} required={obrigatorio} rows={3}
        className={cx(baseCampo, "py-2", erro ? "border-perigo" : "border-borda")} {...p} />
      <Rodape id={i} erro={erro} dica={dica} />
    </div>
  );
}

/* ---------------- Estrutura ---------------- */
export function Cartao({ titulo, acao, children, className }: { titulo?: ReactNode; acao?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-xl border border-borda bg-superficie", className)}>
      {(titulo || acao) && (
        <header className="flex items-center justify-between gap-3 border-b border-borda px-4 py-3">
          {titulo && <h2 className="text-base font-semibold">{titulo}</h2>}
          {acao}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function CabecalhoPagina({ titulo, descricao, acoes }: { titulo: string; descricao?: string; acoes?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold">{titulo}</h1>
        {descricao && <p className="mt-1 text-sm text-texto-suave">{descricao}</p>}
      </div>
      {acoes && <div className="flex flex-wrap gap-2">{acoes}</div>}
    </div>
  );
}

const tons: Record<Tom, string> = {
  neutro: "bg-fundo text-texto-suave border-borda",
  info: "bg-info-suave text-info border-info/20",
  sucesso: "bg-sucesso-suave text-sucesso border-sucesso/20",
  alerta: "bg-alerta-suave text-alerta border-alerta/20",
  perigo: "bg-perigo-suave text-perigo border-perigo/20",
};
export function Selo({ tom = "neutro", children }: { tom?: Tom; children: ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", tons[tom])}>{children}</span>;
}

/* ---------------- Estados ---------------- */
export function Carregando({ texto = "Carregando…" }: { texto?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-texto-suave" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden /> {texto}
    </div>
  );
}

export function EstadoVazio({ titulo, descricao, acao }: { titulo: string; descricao?: string; acao?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-12 text-center">
      <Inbox className="mb-3 size-8 text-texto-suave" aria-hidden />
      <p className="font-medium">{titulo}</p>
      {descricao && <p className="mt-1 max-w-md text-sm text-texto-suave">{descricao}</p>}
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  );
}

export function EstadoErro({ mensagem, tentarNovamente }: { mensagem: string; tentarNovamente?: () => void }) {
  return (
    <div className="flex flex-col items-center px-4 py-12 text-center" role="alert">
      <AlertTriangle className="mb-3 size-8 text-perigo" aria-hidden />
      <p className="font-medium">Não foi possível carregar</p>
      <p className="mt-1 max-w-md text-sm text-texto-suave">{mensagem}</p>
      {tentarNovamente && <Botao variante="secundaria" className="mt-4" onClick={tentarNovamente}>Tentar novamente</Botao>}
    </div>
  );
}

export function Aviso({ tom = "info", children }: { tom?: Tom; children: ReactNode }) {
  return <div className={cx("rounded-lg border px-3 py-2 text-sm", tons[tom])}>{children}</div>;
}

/* ---------------- Modal ---------------- */
export function Modal({ aberto, aoFechar, titulo, descricao, children, largura = "max-w-lg" }: {
  aberto: boolean; aoFechar: () => void; titulo: string; descricao?: string; children: ReactNode; largura?: string;
}) {
  return (
    <Dialog.Root open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <AnimatePresence>
        {aberto && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div className="fixed inset-0 z-40 bg-texto/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild aria-describedby={descricao ? undefined : undefined}>
              <motion.div
                className={cx("fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-superficie p-6 shadow-xl", largura)}
                initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.15 }}
              >
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <Dialog.Title className="font-display text-xl font-semibold">{titulo}</Dialog.Title>
                    {descricao ? <Dialog.Description className="mt-1 text-sm text-texto-suave">{descricao}</Dialog.Description>
                      : <Dialog.Description className="sr-only">{titulo}</Dialog.Description>}
                  </div>
                  <Dialog.Close className="rounded-lg p-1 text-texto-suave hover:bg-fundo" aria-label="Fechar"><X className="size-5" /></Dialog.Close>
                </div>
                {children}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

/* ---------------- Avisos (toast) ---------------- */
type Toast = { id: number; tipo: "sucesso" | "erro"; texto: string };
const ToastCtx = createContext<(tipo: Toast["tipo"], texto: string) => void>(() => {});

export function ProvedorAvisos({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Toast[]>([]);
  const avisar = useCallback((tipo: Toast["tipo"], texto: string) => {
    const id = Date.now() + Math.random();
    setLista((l) => [...l, { id, tipo, texto }]);
    setTimeout(() => setLista((l) => l.filter((t) => t.id !== id)), tipo === "erro" ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={avisar}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[calc(100%-32px)] max-w-sm flex-col gap-2" aria-live="polite">
        <AnimatePresence>
          {lista.map((t) => (
            <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className={cx("pointer-events-auto flex items-start gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg",
                t.tipo === "sucesso" ? "border-sucesso/20 bg-sucesso-suave text-sucesso" : "border-perigo/20 bg-perigo-suave text-perigo")}>
              {t.tipo === "sucesso" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
              <span>{t.texto}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
export const useAvisos = () => useContext(ToastCtx);

/* ---------------- Tabela ---------------- */
export function Tabela({ cabecalho, children }: { cabecalho: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-borda text-xs uppercase tracking-wide text-texto-suave">
            {cabecalho.map((c) => <th key={c} scope="col" className="px-4 py-3 font-medium">{c}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-borda">{children}</tbody>
      </table>
    </div>
  );
}

export { cx };
