import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock, FileClock, Link2, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import { mensagemErro, supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import { useLojas } from "../lib/dados";
import { data } from "../lib/formato";
import { Aviso, Botao, CabecalhoPagina, Campo, Cartao, Carregando, EstadoErro, EstadoVazio, Modal, Selecao, Tabela, cx, useAvisos } from "../ui/componentes";

type Execucao = { executado_em: string; status: "ok" | "erro"; mensagem: string | null; pessoas: number; periodo_fim: string | null };
type Linha = {
  nome_norm: string; nome_vr: string; departamento: string | null; colaborador_id: string; colaborador_nome: string;
  loja_id: string; loja_nome: string | null; data: string; saldo_min: number;
  mes_positivas_min: number; mes_negativas_min: number; var7_min: number | null; registros_7d: number;
};
type Pendencia = { colaborador_id: string; colaborador_nome: string; loja_nome: string | null; data: string; tipo: string; descricao: string; status: string | null };
type SemVinculo = { nome_norm: string; nome_vr: string; departamento: string | null; data: string; saldo_min: number };
type Resumo = { ultima_execucao: Execucao | null; ultima_ok: Execucao | null; linhas: Linha[]; pendencias: Pendencia[]; sem_vinculo: SemVinculo[] };
type Historico = {
  dias: { data: string; saldo_min: number; positivas_min: number; negativas_min: number; he50_min: number; he100_min: number }[];
  pendencias: { data: string; tipo: string; descricao: string; status: string | null; aberta: boolean }[];
};
const SUBINDO = 120; // +2h em 7 dias
const TIPO_PEND: Record<string, string> = { registro_faltando: "Registro faltando", falta: "Falta não justificada", ajuste: "Ajuste pendente", abono: "Abono pendente", outro: "Outro" };
const diaSemana = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");

/* minutos -> "-68h28" / "+3h05" */
export const horas = (m: number, sinal = true) => {
  const a = Math.abs(m);
  return `${m < 0 ? "−" : sinal && m > 0 ? "+" : ""}${Math.floor(a / 60)}h${String(a % 60).padStart(2, "0")}`;
};
const tomSaldo = (m: number) => (m <= -1200 ? "text-perigo font-semibold" : m < 0 ? "text-perigo" : m >= 2400 ? "text-alerta font-semibold" : m > 0 ? "text-sucesso" : "text-texto-suave");
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function Indicador({ rotulo, valor, icone: Icone, tom, ativo, onClick }: { rotulo: string; valor: number; icone: LucideIcon; tom: string; ativo: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo}
      className={cx("flex items-center gap-3 rounded-xl border bg-superficie p-4 text-left transition-colors hover:border-primaria",
        ativo ? "border-primaria ring-2 ring-primaria/20" : "border-borda")}>
      <span className={cx("inline-flex size-10 shrink-0 items-center justify-center rounded-full", tom)}><Icone className="size-5" aria-hidden /></span>
      <span><span className="block text-2xl font-bold leading-tight tabular-nums">{valor}</span><span className="text-sm text-texto-suave">{rotulo}</span></span>
    </button>
  );
}

/* gráfico simples do saldo dia a dia */
function Grafico({ dias }: { dias: Historico["dias"] }) {
  const pts = [...dias].reverse();
  if (pts.length < 2) return null;
  const W = 640, H = 160, P = 8;
  const vals = pts.map((d) => d.saldo_min); const min = Math.min(0, ...vals), max = Math.max(0, ...vals); const amp = max - min || 1;
  const x = (i: number) => P + (i * (W - 2 * P)) / (pts.length - 1); const y = (v: number) => P + ((max - v) * (H - 2 * P)) / amp;
  const linha = pts.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.saldo_min).toFixed(1)}`).join(" ");
  return (
    <figure className="rounded-lg border border-borda bg-fundo p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" role="img" aria-label="Evolução do saldo do banco de horas">
        <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} className="stroke-borda" strokeDasharray="4 4" />
        <path d={linha} fill="none" className={vals[vals.length - 1] < 0 ? "stroke-perigo" : "stroke-primaria"} strokeWidth={2.5} strokeLinejoin="round" />
      </svg>
      <figcaption className="mt-1 flex justify-between text-xs text-texto-suave"><span>{data(pts[0].data)}</span><span>linha tracejada = zero</span><span>{data(pts[pts.length - 1].data)}</span></figcaption>
    </figure>
  );
}

function RelatorioPessoa({ l, fechar }: { l: Linha; fechar: () => void }) {
  const q = useQuery({
    queryKey: ["banco-horas-pessoa", l.colaborador_id],
    queryFn: async () => {
      const { data: r, error } = await supabase.rpc("banco_horas_historico", { p_colaborador: l.colaborador_id, p_dias: 45 });
      if (error) throw new Error(error.message);
      return r as Historico;
    },
  });
  const pendDia = new Map<string, Historico["pendencias"]>();
  (q.data?.pendencias ?? []).forEach((p) => pendDia.set(p.data, [...(pendDia.get(p.data) ?? []), p]));
  return (
    <Modal aberto aoFechar={fechar} largura="max-w-3xl" titulo={`Banco de horas · ${l.colaborador_nome}`}
      descricao={`${l.loja_nome?.replace(/^ÓTICAS IDEALIZE /, "") ?? ""} · saldo ${horas(l.saldo_min)} em ${data(l.data)}${l.var7_min !== null ? ` · ${horas(l.var7_min)} em 7 dias` : ""}`}>
      {q.isLoading && <Carregando />}
      {q.error && <EstadoErro mensagem={(q.error as Error).message} tentarNovamente={() => q.refetch()} />}
      {q.data && (
        <div className="flex flex-col gap-4">
          <Grafico dias={q.data.dias} />
          {q.data.pendencias.some((p) => p.aberta) && (
            <Aviso tom="alerta">{q.data.pendencias.filter((p) => p.aberta).length} pendência(s) de ponto em aberto nos últimos 45 dias. Resolva no RH Digital da VR.</Aviso>
          )}
          <div className="max-h-80 overflow-y-auto rounded-lg border border-borda">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-superficie text-xs uppercase text-texto-suave">
                <tr><th className="px-3 py-2">Dia</th><th className="px-3 py-2">Positivas</th><th className="px-3 py-2">Negativas</th><th className="px-3 py-2">Saldo</th><th className="px-3 py-2">Ponto</th></tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {q.data.dias.map((d) => (
                  <tr key={d.data}>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{diaSemana(d.data)}, {data(d.data)}</td>
                    <td className="px-3 py-2 tabular-nums text-sucesso">{d.positivas_min ? horas(d.positivas_min) : "—"}</td>
                    <td className="px-3 py-2 tabular-nums text-perigo">{d.negativas_min ? horas(d.negativas_min) : "—"}</td>
                    <td className={cx("px-3 py-2 tabular-nums", tomSaldo(d.saldo_min))}>{horas(d.saldo_min)}</td>
                    <td className="px-3 py-2 text-xs">
                      {(pendDia.get(d.data) ?? []).map((p, i) => (
                        <span key={i} className={cx("mr-1 inline-block whitespace-nowrap rounded-full border px-2 py-0.5", p.aberta ? "border-alerta text-alerta" : "border-borda text-texto-suave")}>
                          {p.aberta ? (TIPO_PEND[p.tipo] ?? p.descricao) : p.descricao}{!p.aberta && p.status ? ` · ${p.status.toLowerCase()}` : ""}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between">
            <Link to={`/colaboradores/${l.colaborador_id}`} className="text-sm text-primaria hover:underline">Abrir ficha</Link>
            <Botao variante="secundaria" onClick={fechar}>Fechar</Botao>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Vincular({ s, fechar }: { s: SemVinculo; fechar: () => void }) {
  const qc = useQueryClient(); const avisar = useAvisos();
  const [busca, setBusca] = useState(""); const [escolhido, setEscolhido] = useState("");
  const colabs = useQuery({
    queryKey: ["colaboradores-busca-bh"],
    queryFn: async () => {
      const { data: r, error } = await supabase.from("v_colaboradores").select("id,nome_completo,loja_nome,status").order("nome_completo").limit(1000);
      if (error) throw new Error(error.message);
      return r as { id: string; nome_completo: string; loja_nome: string | null; status: string }[];
    },
  });
  const lista = (colabs.data ?? []).filter((c) => !busca || c.nome_completo.toLowerCase().includes(busca.toLowerCase())).slice(0, 50);
  const m = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc("banco_horas_vincular", { p_nome_norm: s.nome_norm, p_colaborador: escolhido }); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["banco-horas"] }); avisar("sucesso", "Nome do VR vinculado ao colaborador."); fechar(); },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  return (
    <Modal aberto aoFechar={fechar} titulo="Vincular ao colaborador" descricao={`No VR: ${s.nome_vr}${s.departamento ? ` · ${s.departamento}` : ""}`}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (escolhido) m.mutate(); }} className="flex flex-col gap-4">
        <Campo rotulo="Buscar colaborador" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Digite parte do nome" autoFocus />
        <ul className="max-h-72 overflow-y-auto rounded-lg border border-borda">
          {colabs.isLoading && <li className="p-3 text-sm text-texto-suave">Carregando…</li>}
          {lista.map((c) => (
            <li key={c.id}>
              <label className={cx("flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-fundo", escolhido === c.id && "bg-primaria-suave")}>
                <input type="radio" name="colab" checked={escolhido === c.id} onChange={() => setEscolhido(c.id)} className="accent-[var(--color-primaria)]" />
                <span><span className="font-medium">{c.nome_completo}</span><span className="block text-xs text-texto-suave">{c.loja_nome ?? "—"}</span></span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundaria" onClick={fechar}>Cancelar</Botao>
          <Botao type="submit" carregando={m.isPending} disabled={!escolhido}>Vincular</Botao>
        </div>
      </form>
    </Modal>
  );
}

export function BancoHoras() {
  const { pode } = useAuth();
  const lojas = useLojas();
  const [loja, setLoja] = useState("");
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"" | "negativo" | "positivo" | "subindo" | "registros">("");
  const [params, setParams] = useSearchParams();
  const [vinculando, setVinculando] = useState<SemVinculo | null>(null);
  const q = useQuery({
    queryKey: ["banco-horas", loja],
    queryFn: async () => {
      const { data: r, error } = await supabase.rpc("banco_horas_resumo", { p_loja: loja || null });
      if (error) throw new Error(error.message);
      return r as Resumo;
    },
  });
  const linhas = useMemo(() => (q.data?.linhas ?? []).filter((l) =>
    (!busca || l.colaborador_nome.toLowerCase().includes(busca.toLowerCase())) &&
    (!filtro || (filtro === "negativo" ? l.saldo_min < 0 : filtro === "positivo" ? l.saldo_min > 0
      : filtro === "subindo" ? (l.var7_min ?? 0) >= SUBINDO : l.registros_7d > 0))), [q.data, busca, filtro]);
  const todos = q.data?.linhas ?? [];
  const ult = q.data?.ultima_execucao; const ok = q.data?.ultima_ok;
  const pessoa = todos.find((l) => l.colaborador_id === params.get("pessoa")) ?? null;
  const abrir = (l: Linha | null) => { const p = new URLSearchParams(params); if (l) p.set("pessoa", l.colaborador_id); else p.delete("pessoa"); setParams(p, { replace: true }); };
  const alternar = (f: typeof filtro) => setFiltro(filtro === f ? "" : f);
  const atrasado = !ok || Date.now() - new Date(ok.executado_em).getTime() > 50 * 3600e3;

  return (
    <div className="flex flex-col gap-6">
      <CabecalhoPagina titulo="Banco de horas"
        descricao="Saldo de banco de horas de cada colaborador, lido todo dia às 9h do RH Digital da VR (Pontomais)."
        acoes={(lojas.data?.length ?? 0) > 1 && (
          <Selecao rotulo="Loja" value={loja} onChange={(e) => setLoja(e.target.value)} className="w-56">
            <option value="">Todas as lojas</option>
            {lojas.data!.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </Selecao>
        )} />

      {q.isLoading && <Carregando />}
      {q.error && <EstadoErro mensagem={(q.error as Error).message} tentarNovamente={() => q.refetch()} />}
      {q.data && (
        <>
          {!ult ? (
            <Aviso tom="info">O robô do VR ainda não rodou. Assim que rodar pela primeira vez, os saldos aparecem aqui.</Aviso>
          ) : ult.status === "erro" || atrasado ? (
            <Aviso tom="alerta">
              <span className="inline-flex items-center gap-2 font-medium"><AlertTriangle className="size-4" aria-hidden />Última leitura do VR falhou em {dataHora(ult.executado_em)}</span>
              {ult.mensagem && <span className="block">{ult.mensagem}</span>}
              {ok && <span className="block">Os saldos abaixo são da última leitura que deu certo: {dataHora(ok.executado_em)}.</span>}
            </Aviso>
          ) : (
            <p className="-mt-2 inline-flex items-center gap-2 text-sm text-texto-suave">
              <CheckCircle2 className="size-4 text-sucesso" aria-hidden />Atualizado em {dataHora(ult.executado_em)} · {ult.pessoas} pessoas no VR
            </p>
          )}

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Indicador rotulo="Com saldo negativo" valor={todos.filter((l) => l.saldo_min < 0).length} icone={TrendingDown} tom="bg-perigo-suave text-perigo"
              ativo={filtro === "negativo"} onClick={() => alternar("negativo")} />
            <Indicador rotulo="Com saldo positivo" valor={todos.filter((l) => l.saldo_min > 0).length} icone={TrendingUp} tom="bg-sucesso-suave text-sucesso"
              ativo={filtro === "positivo"} onClick={() => alternar("positivo")} />
            <Indicador rotulo="Subindo (+2h em 7 dias)" valor={todos.filter((l) => (l.var7_min ?? 0) >= SUBINDO).length} icone={ArrowUpRight} tom="bg-alerta-suave text-alerta"
              ativo={filtro === "subindo"} onClick={() => alternar("subindo")} />
            <Indicador rotulo="Registro faltando (7 dias)" valor={todos.filter((l) => l.registros_7d > 0).length} icone={FileClock} tom="bg-info-suave text-info"
              ativo={filtro === "registros"} onClick={() => alternar("registros")} />
          </div>

          <Cartao titulo={`Saldos (${linhas.length})`} acao={<Campo rotulo="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome" className="w-48" />}>
            {linhas.length === 0 ? <EstadoVazio titulo="Nada aqui" descricao="Nenhum colaborador com esse filtro." /> : (
              <Tabela cabecalho={["Colaborador", "Loja", "Saldo atual", "Últimos 7 dias", "No mês: + / −", "Registros", "Saldo em"]}>
                {linhas.map((l) => (
                  <tr key={l.nome_norm} className="hover:bg-fundo">
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => abrir(l)} className="text-left font-medium hover:text-primaria hover:underline">{l.colaborador_nome}</button>
                      {l.departamento && <p className="text-xs text-texto-suave">{l.departamento}</p>}
                    </td>
                    <td className="px-4 py-3">{l.loja_nome?.replace(/^ÓTICAS IDEALIZE /, "") ?? "—"}</td>
                    <td className={cx("px-4 py-3 tabular-nums", tomSaldo(l.saldo_min))}>{horas(l.saldo_min)}</td>
                    <td className={cx("px-4 py-3 tabular-nums", (l.var7_min ?? 0) >= SUBINDO ? "font-semibold text-alerta" : "text-texto-suave")}>
                      {l.var7_min === null ? "—" : <>{(l.var7_min ?? 0) >= SUBINDO && <ArrowUpRight className="mr-0.5 inline size-3.5" aria-label="subindo" />}{horas(l.var7_min)}</>}
                    </td>
                    <td className="px-4 py-3 tabular-nums"><span className="text-sucesso">{l.mes_positivas_min ? horas(l.mes_positivas_min) : "—"}</span>
                      <span className="text-texto-suave"> / </span><span className="text-perigo">{l.mes_negativas_min ? horas(l.mes_negativas_min) : "—"}</span></td>
                    <td className="px-4 py-3">{l.registros_7d > 0 ? <span className="whitespace-nowrap rounded-full border border-alerta px-2 py-0.5 text-xs font-medium text-alerta">{l.registros_7d} faltando</span> : <span className="text-texto-suave">—</span>}</td>
                    <td className="px-4 py-3 tabular-nums text-texto-suave">{data(l.data)}</td>
                  </tr>
                ))}
              </Tabela>
            )}
            <p className="mt-4 flex items-center gap-2 text-xs text-texto-suave"><Clock className="size-3.5" aria-hidden />
              Clique no nome para ver o relatório dia a dia. Vermelho: saldo negativo (forte a partir de −20h). Laranja: acima de +40h ou subindo. Ajustes continuam sendo feitos no RH Digital da VR.</p>
          </Cartao>

          {q.data.pendencias.length > 0 && (
            <Cartao titulo={`Registros de ponto em aberto (${q.data.pendencias.length})`}>
              <p className="mb-3 text-sm text-texto-suave">Últimos 35 dias, conforme o relatório de pendências do VR: batidas faltando, faltas sem justificativa e ajustes ou abonos esperando aprovação.</p>
              <Tabela cabecalho={["Dia", "Colaborador", "Loja", "Pendência", "Situação no VR"]}>
                {q.data.pendencias.map((p, i) => (
                  <tr key={i} className="hover:bg-fundo">
                    <td className="px-4 py-3 tabular-nums">{diaSemana(p.data)}, {data(p.data)}</td>
                    <td className="px-4 py-3">
                      <button type="button" className="text-left font-medium hover:text-primaria hover:underline"
                        onClick={() => { const l = todos.find((x) => x.colaborador_id === p.colaborador_id); if (l) abrir(l); }}>{p.colaborador_nome}</button>
                    </td>
                    <td className="px-4 py-3">{p.loja_nome?.replace(/^ÓTICAS IDEALIZE /, "") ?? "—"}</td>
                    <td className={cx("px-4 py-3", p.tipo === "registro_faltando" || p.tipo === "falta" ? "font-medium text-alerta" : "")}>{TIPO_PEND[p.tipo] ?? p.descricao}</td>
                    <td className="px-4 py-3 text-texto-suave">{p.status ?? "—"}</td>
                  </tr>
                ))}
              </Tabela>
            </Cartao>
          )}

          {q.data.sem_vinculo.length > 0 && (
            <Cartao titulo={`Nomes do VR sem colaborador no RH 360 (${q.data.sem_vinculo.length})`}>
              <p className="mb-3 text-sm text-texto-suave">O nome no VR não bateu com nenhum cadastro (ou bateu com mais de um). Vincule para o saldo aparecer na lista.</p>
              <Tabela cabecalho={["Nome no VR", "Equipe no VR", "Saldo", ""]}>
                {q.data.sem_vinculo.map((s) => (
                  <tr key={s.nome_norm} className="hover:bg-fundo">
                    <td className="px-4 py-3 font-medium">{s.nome_vr}</td>
                    <td className="px-4 py-3 text-texto-suave">{s.departamento ?? "—"}</td>
                    <td className={cx("px-4 py-3 tabular-nums", tomSaldo(s.saldo_min))}>{horas(s.saldo_min)}</td>
                    <td className="px-4 py-3 text-right">
                      {pode("colaborador.editar") && <Botao tamanho="sm" variante="secundaria" icone={<Link2 className="size-4" />} onClick={() => setVinculando(s)}>Vincular</Botao>}
                    </td>
                  </tr>
                ))}
              </Tabela>
            </Cartao>
          )}
        </>
      )}
      {vinculando && <Vincular s={vinculando} fechar={() => setVinculando(null)} />}
      {pessoa && <RelatorioPessoa l={pessoa} fechar={() => abrir(null)} />}
    </div>
  );
}
