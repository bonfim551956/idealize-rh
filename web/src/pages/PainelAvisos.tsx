import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CakeSlice, CalendarClock, Palmtree, type LucideIcon } from "lucide-react";
import { supabase } from "../lib/supabase";
import { data } from "../lib/formato";
import { Cartao, Carregando, EstadoErro, Selo } from "../ui/componentes";

type Experiencia = {
  colaborador_id: string; nome: string; loja: string; admissao: string;
  fim_primeiro: string; fim_prorrogacao: string; regra: string; fase: "primeiro" | "prorrogacao" | "vencido"; termina_em: string; dias: number;
};
type Ferias = {
  colaborador_id: string; nome: string; loja: string; aquisitivo_inicio: string; aquisitivo_fim: string;
  concessivo_fim: string; dias_gozados: number; saldo: number; sair_ate: string; dias: number;
};
type Aniversario = { colaborador_id: string; nome: string; loja: string; dia: string; dias: number };
type Avisos = { experiencia: Experiencia[]; ferias: Ferias[]; aniversarios: Aniversario[] };

function prazo(dias: number, vencidoTexto = "Vencido") {
  if (dias < 0) return <Selo tom="perigo">{vencidoTexto} há {-dias} {-dias === 1 ? "dia" : "dias"}</Selo>;
  if (dias === 0) return <Selo tom="perigo">Hoje</Selo>;
  if (dias <= 7) return <Selo tom="alerta">Em {dias} {dias === 1 ? "dia" : "dias"}</Selo>;
  return <Selo tom="info">Em {dias} dias</Selo>;
}

function Lista<T extends { colaborador_id: string }>({ titulo, icone: Icone, vazio, itens, render, rodape }: {
  titulo: string; icone: LucideIcon; vazio: string; itens: T[]; render: (i: T) => ReactNode; rodape?: string;
}) {
  return (
    <Cartao titulo={<span className="inline-flex items-center gap-2"><Icone className="size-4 text-texto-suave" aria-hidden />{titulo}
      {itens.length > 0 && <Selo>{itens.length}</Selo>}</span>}>
      {itens.length === 0 ? <p className="text-sm text-texto-suave">{vazio}</p> : (
        <ul className="flex flex-col divide-y divide-borda">
          {itens.map((i, n) => (
            <li key={`${i.colaborador_id}-${n}`} className="py-3 first:pt-0 last:pb-0">{render(i)}</li>
          ))}
        </ul>
      )}
      {rodape && <p className="mt-3 text-xs text-texto-suave">{rodape}</p>}
    </Cartao>
  );
}

function Nome({ id, nome, loja }: { id: string; nome: string; loja: string }) {
  return (
    <div className="min-w-0">
      <Link to={`/colaboradores/${id}`} className="block truncate font-medium hover:text-primaria hover:underline">{nome}</Link>
      <p className="truncate text-xs text-texto-suave">{loja}</p>
    </div>
  );
}

export function PainelAvisos({ loja }: { loja: string }) {
  const q = useQuery({
    queryKey: ["painel-avisos", loja],
    queryFn: async () => {
      const { data: r, error } = await supabase.rpc("painel_avisos", { p_loja: loja || null });
      if (error) throw new Error(error.message);
      return r as Avisos;
    },
  });
  if (q.isLoading) return <Carregando />;
  if (q.error) return <EstadoErro mensagem={(q.error as Error).message} tentarNovamente={() => q.refetch()} />;
  const a = q.data!;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Lista titulo="Período de experiência" icone={CalendarClock} itens={a.experiencia}
        vazio="Nenhum contrato de experiência terminando nos próximos 7 dias."
        rodape="Regra do cargo: 15 + 15 dias (consultores: 15 + 30). Decida antes do fim: prorrogar, efetivar ou encerrar. “Encerrada” = o prazo passou e o cadastro ainda está como experiência."
        render={(e) => (
          <div className="flex items-start justify-between gap-3">
            <Nome id={e.colaborador_id} nome={e.nome} loja={e.loja} />
            <div className="flex shrink-0 flex-col items-end gap-1 text-right">
              {e.fase === "vencido" ? <Selo tom="perigo">Atualizar contrato</Selo> : prazo(e.dias)}
              <span className="text-xs text-texto-suave">
                {e.fase === "primeiro" ? `1º período (${e.regra}) termina ${data(e.termina_em)}`
                  : e.fase === "prorrogacao" ? `Prorrogação (${e.regra}) termina ${data(e.termina_em)}`
                  : `Experiência (${e.regra}) encerrada em ${data(e.termina_em)}`}
              </span>
            </div>
          </div>
        )} />

      <Lista titulo="Férias a vencer" icone={Palmtree} itens={a.ferias}
        vazio="Nenhum período de férias vencendo nos próximos 90 dias."
        rodape="“Sair até” é o último dia para iniciar o saldo dentro do período concessivo (depois disso, férias em dobro)."
        render={(f) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Nome id={f.colaborador_id} nome={f.nome} loja={f.loja} />
              <p className="mt-1 text-xs text-texto-suave">
                Aquisitivo {data(f.aquisitivo_inicio)} a {data(f.aquisitivo_fim)} · saldo {f.saldo} {f.saldo === 1 ? "dia" : "dias"}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1 text-right">
              {prazo(f.dias, "Venceu")}
              <span className="text-xs text-texto-suave">Sair até {data(f.sair_ate)}</span>
            </div>
          </div>
        )} />

      <Lista titulo="Aniversariantes" icone={CakeSlice} itens={a.aniversarios}
        vazio="Nenhum aniversário nos próximos 30 dias."
        render={(b) => (
          <div className="flex items-center justify-between gap-3">
            <Nome id={b.colaborador_id} nome={b.nome} loja={b.loja} />
            <div className="shrink-0 text-right">
              {b.dias === 0 ? <Selo tom="sucesso">Hoje 🎉</Selo> : b.dias === 1 ? <Selo tom="info">Amanhã</Selo>
                : <span className="text-sm font-medium">{new Date(`${b.dia}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>}
            </div>
          </div>
        )} />
    </div>
  );
}
