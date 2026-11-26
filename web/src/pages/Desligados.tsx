import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, Search } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useLojas } from "../lib/dados";
import { data } from "../lib/formato";
import { MODALIDADES } from "./Ficha";
import { CabecalhoPagina, Campo, Cartao, Carregando, EstadoErro, EstadoVazio, Selecao, Tabela } from "../ui/componentes";

type Desligado = {
  colaborador_id: string; nome: string; loja_id: string; loja: string; cargo: string | null; matricula: string | null;
  admissao: string | null; desligamento: string | null; modalidade: string | null; ultimo_dia: string | null; documentos: number;
};
const MODALIDADE: Record<string, string> = Object.fromEntries(MODALIDADES);
const semAcento = (t: string) => t.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

export function Desligados() {
  const lojas = useLojas();
  const [loja, setLoja] = useState("");
  const [busca, setBusca] = useState("");
  const [ano, setAno] = useState("");
  const q = useQuery({
    queryKey: ["desligados", loja],
    queryFn: async () => {
      const { data: r, error } = await supabase.rpc("desligados_listar", { p_loja: loja || null });
      if (error) throw new Error(error.message);
      return r as Desligado[];
    },
  });
  const anos = useMemo(() => [...new Set((q.data ?? []).map((d) => d.desligamento?.slice(0, 4)).filter(Boolean) as string[])].sort().reverse(), [q.data]);
  const lista = (q.data ?? []).filter((d) => (!busca || semAcento(`${d.nome} ${d.matricula ?? ""}`).includes(semAcento(busca)))
    && (!ano || d.desligamento?.startsWith(ano)));

  return (
    <div className="flex flex-col gap-6">
      <CabecalhoPagina titulo="Desligados"
        descricao="Quem saiu da empresa. Eles não aparecem mais no vale-transporte, banco de horas, férias e pendências; a ficha e todos os arquivos ficam guardados aqui para consulta." />
      <Cartao>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="relative">
            <Campo rotulo="Buscar" placeholder="Nome ou matrícula" value={busca} onChange={(e) => setBusca(e.target.value)} className="[&_input]:pl-9" />
            <Search className="pointer-events-none absolute bottom-3 left-3 size-4 text-texto-suave" aria-hidden />
          </div>
          {(lojas.data?.length ?? 0) > 1 && (
            <Selecao rotulo="Loja" value={loja} onChange={(e) => setLoja(e.target.value)}>
              <option value="">Todas</option>
              {lojas.data!.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </Selecao>
          )}
          <Selecao rotulo="Ano do desligamento" value={ano} onChange={(e) => setAno(e.target.value)}>
            <option value="">Todos</option>
            {anos.map((a) => <option key={a} value={a}>{a}</option>)}
          </Selecao>
        </div>
        {q.isLoading && <Carregando />}
        {q.error && <EstadoErro mensagem={(q.error as Error).message} tentarNovamente={() => q.refetch()} />}
        {q.data && lista.length === 0 && <EstadoVazio titulo="Nenhum desligado" descricao={q.data.length ? "Nada com esse filtro." : undefined} />}
        {lista.length > 0 && (
          <Tabela cabecalho={["Nome", "Loja", "Cargo", "Admissão", "Desligamento", "Modalidade", ""]}>
            {lista.map((d) => (
              <tr key={d.colaborador_id} className="hover:bg-fundo">
                <td className="px-4 py-3">
                  <Link to={`/colaboradores/${d.colaborador_id}`} className="font-medium text-primaria hover:underline">{d.nome}</Link>
                  {d.matricula && <p className="text-xs text-texto-suave">Matrícula {d.matricula}</p>}
                </td>
                <td className="px-4 py-3">{d.loja.replace(/^ÓTICAS IDEALIZE /, "")}</td>
                <td className="px-4 py-3">{d.cargo ?? "—"}</td>
                <td className="px-4 py-3 tabular-nums">{data(d.admissao)}</td>
                <td className="px-4 py-3 tabular-nums">{data(d.desligamento)}</td>
                <td className="px-4 py-3">{d.modalidade ? MODALIDADE[d.modalidade] ?? d.modalidade.replace(/_/g, " ") : "—"}</td>
                <td className="px-4 py-3 text-right">
                  <Link to={`/colaboradores/${d.colaborador_id}?aba=documentos`}
                    className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-borda bg-superficie px-3 text-xs font-medium hover:bg-fundo">
                    <FolderOpen className="size-4" aria-hidden />{d.documentos} arquivo{d.documentos === 1 ? "" : "s"}
                  </Link>
                </td>
              </tr>
            ))}
          </Tabela>
        )}
      </Cartao>
    </div>
  );
}
