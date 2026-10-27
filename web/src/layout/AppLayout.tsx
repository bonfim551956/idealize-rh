import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, FileText, LayoutDashboard, LogOut, Menu, ScrollText, ShieldCheck, Shirt, Store, Bus, UserCog, Users, X } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { cx } from "../ui/componentes";

type Item = { para: string; rotulo: string; icone: typeof Users; visivel: boolean };

export function AppLayout() {
  const { nome, pode, permissoes, sair } = useAuth();
  const [menuAberto, setMenuAberto] = useState(false);
  const local = useLocation();
  const leDocumentos = permissoes.some((p) => /^documento\.[a-z]+\.ler$/.test(p.permissao) && p.liberada_na_sessao);

  const itens: Item[] = [
    { para: "/", rotulo: "Painel", icone: LayoutDashboard, visivel: pode("dashboard.ver") || pode("colaborador.ler") },
    { para: "/colaboradores", rotulo: "Colaboradores", icone: Users, visivel: pode("colaborador.ler") },
    { para: "/documentos", rotulo: "Documentos", icone: FileText, visivel: leDocumentos },
    { para: "/uniformes", rotulo: "Uniformes", icone: Shirt, visivel: pode("uniforme.ler") },
    { para: "/vale-transporte", rotulo: "VT e ausências", icone: Bus, visivel: pode("vt.ler") || pode("ausencia.ler") },
    { para: "/lojas", rotulo: "Lojas e estrutura", icone: Store, visivel: pode("config.estrutura.gerir") },
    { para: "/acessos", rotulo: "Usuários e acessos", icone: UserCog, visivel: pode("acesso.gerir") },
    { para: "/auditoria", rotulo: "Auditoria", icone: ScrollText, visivel: pode("auditoria.ler") },
    { para: "/conta", rotulo: "Minha conta", icone: ShieldCheck, visivel: true },
    { para: "/manual", rotulo: "Manual", icone: BookOpen, visivel: true },
  ];

  const nav = (
    <nav className="flex flex-col gap-1" aria-label="Principal">
      {itens.filter((i) => i.visivel).map(({ para, rotulo, icone: Icone }) => (
        <NavLink key={para} to={para} end={para === "/"} onClick={() => setMenuAberto(false)}
          className={({ isActive }) => cx(
            "flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
            isActive ? "bg-primaria-suave text-primaria" : "text-texto-suave hover:bg-fundo hover:text-texto",
          )}>
          <Icone className="size-4" aria-hidden /> {rotulo}
        </NavLink>
      ))}
    </nav>
  );

  const marca = (
    <div className="flex flex-col gap-1 px-3">
      <img src="/logo.png" alt="Óticas Idealize" width={600} height={182} className="h-auto w-36 select-none" draggable={false} />
      <p className="font-display text-xs font-semibold tracking-wide text-primaria">RH 360º · Gestão de Pessoas</p>
    </div>
  );

  const rodape = (
    <div className="border-t border-borda px-3 pt-4">
      <p className="truncate text-sm font-medium" title={nome}>{nome}</p>
      <button onClick={sair} className="mt-2 flex h-8 items-center gap-2 rounded-lg text-sm text-texto-suave hover:text-perigo">
        <LogOut className="size-4" aria-hidden /> Sair
      </button>
    </div>
  );

  return (
    <div className="min-h-dvh lg:flex">
      {/* Barra superior (celular) */}
      <header className="sticky top-0 z-30 flex h-14 print:hidden items-center justify-between border-b border-borda bg-superficie px-4 lg:hidden">
        <img src="/logo.png" alt="Óticas Idealize" width={600} height={182} className="h-8 w-auto select-none" draggable={false} />
        <button onClick={() => setMenuAberto(true)} className="rounded-lg p-2 hover:bg-fundo" aria-label="Abrir menu"><Menu className="size-5" /></button>
      </header>

      {/* Menu lateral (desktop) */}
      <aside className="hidden print:!hidden w-64 shrink-0 flex-col justify-between border-r border-borda bg-superficie py-4 lg:sticky lg:top-0 lg:flex lg:h-dvh">
        <div className="flex flex-col gap-6">{marca}<div className="px-3">{nav}</div></div>
        {rodape}
      </aside>

      {/* Menu lateral (celular) */}
      <AnimatePresence>
        {menuAberto && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-texto/40 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMenuAberto(false)} />
            <motion.aside className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col justify-between bg-superficie py-4 lg:hidden"
              initial={{ x: -288 }} animate={{ x: 0 }} exit={{ x: -288 }} transition={{ duration: 0.2 }}>
              <div className="flex flex-col gap-6">
                <div className="flex items-center justify-between pr-3">{marca}
                  <button onClick={() => setMenuAberto(false)} className="rounded-lg p-2 hover:bg-fundo" aria-label="Fechar menu"><X className="size-5" /></button>
                </div>
                <div className="px-3">{nav}</div>
              </div>
              {rodape}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 print:p-0" key={local.pathname}>
        <div className="mx-auto max-w-6xl"><Outlet /></div>
      </main>
    </div>
  );
}
