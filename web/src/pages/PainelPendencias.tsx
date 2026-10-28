import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronRight, ClipboardList } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Cartao, Carregando, EstadoErro, Selo } from "../ui/componentes";

type Item = { nome: string; detalhe: string; link: string };
type Pendencia = {
  chave: string; titulo: string; gravidade: "alta" | "media" | "baixa"; quantidade: number;
  link: string; acao: string; itens: Item[];
};

const ordem = { alta: 0, media: 1, baixa: 2 } as const;
const tom = { alta: "perigo", media: "alerta", baixa: "info" } as const;
const rotulo = { alta: "Urgente", media: "Atenção", baixa: "Rotina" } as const;

function Linha({ p }: { p: Pendencia }) {
  const [aberto, setAberto] = useState(p.gravidade === "alta");
  const temItens = p.itens.length > 0;
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setAberto(!aberto)} disabled={!temItens} aria-expanded={aberto}
          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default">
          {temItens ? (aberto ? <ChevronDown className="size-4 shrink-0 text-texto-suave" aria-hidden />
            : <ChevronRight className="size-4 shrink-0 text-texto-suave" aria-hidden />) : <span className="size-4 shrink-0" />}
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primaria-suave text-sm font-semibold text-primaria">{p.quantidade}</span>
          <span className="min-w-0 font-medium leading-tight">{p.titulo}</span>
        </button>
        <Selo tom={tom[p.gravidade]}>{rotulo[p.gravidade]}</Selo>
        {p.link !== "/" && (
          <Link to={p.link} className={`${temItens ? "hidden sm:inline" : "inline"} shrink-0 text-sm font-medium text-primaria hover:underline`}>{p.acao} →</Link>
        )}
      </div>
      {aberto && temItens && (
        <ul className="ml-[3.25rem] mt-2 flex flex-col gap-1.5">
          {p.itens.map((i, n) => (
            <li key={n} className="text-sm">
              <Link to={i.link} className="font-medium hover:text-primaria hover:underline">{i.nome}</Link>
              <span className="text-texto-suave"> · {i.detalhe}</span>
            </li>
          ))}
          {p.quantidade > p.itens.length && (
            <li className="text-xs text-texto-suave">
              e mais {p.quantidade - p.itens.length}{p.link !== "/" && <> — <Link to={p.link} className="text-primaria hover:underline">ver todos</Link></>}
            </li>
          )}
          {p.link !== "/" && (
            <li className="sm:hidden"><Link to={p.link} className="text-sm font-medium text-primaria hover:underline">{p.acao} →</Link></li>
          )}
        </ul>
      )}
    </li>
  );
}

export function PainelPendencias({ loja }: { loja: string }) {
  const q = useQuery({
    queryKey: ["painel-pendencias", loja],
    queryFn: async () => {
      const { data: r, error } = await supabase.rpc("painel_pendencias", { p_loja: loja || null });
      if (error) throw new Error(error.message);
      return (r as { pendencias: Pendencia[] }).pendencias;
    },
  });
  if (q.isLoading) return <Carregando texto="Levantando pendências…" />;
  if (q.error) return <EstadoErro mensagem={(q.error as Error).message} tentarNovamente={() => q.refetch()} />;
  const lista = [...q.data!].sort((a, b) => ordem[a.gravidade] - ordem[b.gravidade]);
  const total = lista.reduce((s, p) => s + p.quantidade, 0);

  return (
    <Cartao titulo={<span className="inline-flex items-center gap-2"><ClipboardList className="size-4 text-texto-suave" aria-hidden />
      Pendências do RH {total > 0 && <Selo tom={lista.some((p) => p.gravidade === "alta") ? "perigo" : "alerta"}>{total}</Selo>}</span>}>
      {lista.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-texto-suave"><CheckCircle2 className="size-4 text-sucesso" aria-hidden />Nenhuma pendência no momento.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-borda">{lista.map((p) => <Linha key={p.chave} p={p} />)}</ul>
      )}
    </Cartao>
  );
}
