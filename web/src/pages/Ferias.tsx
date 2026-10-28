import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck2, CalendarClock, CalendarPlus, CalendarX2, Hourglass, type LucideIcon } from "lucide-react";
import { mensagemErro, supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import { useLojas } from "../lib/dados";
import { data } from "../lib/formato";
import { AreaTexto, Aviso, Botao, CabecalhoPagina, Campo, Cartao, Carregando, EstadoErro, EstadoVazio, Modal, Selecao, Selo, Tabela, cx, useAvisos } from "../ui/componentes";

/* Um período aquisitivo em aberto (como na "Programação de férias" da contabilidade) */
export type PeriodoFerias = {
  colaborador_id: string; nome: string; loja_id: string; loja: string; empresa: string; admissao: string;
  aquisitivo_inicio: string; aquisitivo_fim: string; completo: boolean;
  dias_direito: number; dias_gozados: number; abono: number; saldo: number; saldo_livre: number;
  limite: string; concessivo_fim: string; dias_ate_limite: number;
  programado_inicio: string | null; programado_dias: number | null; programado_abono: number | null;
  situacao: "vencida" | "urgente" | "a_programar" | "programada" | "em_aquisicao";
};

const SITUACAO: Record<PeriodoFerias["situacao"], { rotulo: string; tom: "perigo" | "alerta" | "info" | "sucesso" | "neutro" }> = {
  vencida: { rotulo: "Vencida (em dobro)", tom: "perigo" },
  urgente: { rotulo: "Limite em até 90 dias", tom: "alerta" },
  a_programar: { rotulo: "A programar", tom: "info" },
  programada: { rotulo: "Programada", tom: "sucesso" },
  em_aquisicao: { rotulo: "Em aquisição", tom: "neutro" },
};
const ordem = { vencida: 0, urgente: 1, a_programar: 2, programada: 3, em_aquisicao: 4 } as const;
const dias = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

function Resumo({ rotulo, valor, icone: Icone, tom, ativo, onClick }: {
  rotulo: string; valor: number; icone: LucideIcon; tom: string; ativo: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo}
      className={cx("flex items-center gap-3 rounded-xl border bg-superficie p-4 text-left transition-colors hover:border-primaria",
        ativo ? "border-primaria ring-2 ring-primaria/20" : "border-borda")}>
      <span className={cx("inline-flex size-10 shrink-0 items-center justify-center rounded-full", tom)}><Icone className="size-5" aria-hidden /></span>
      <span><span className="block text-2xl font-bold leading-tight tabular-nums">{valor}</span><span className="text-sm text-texto-suave">{rotulo}</span></span>
    </button>
  );
}

const somaDias = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

/* Lançar férias de um período: com datas (programadas ou já tiradas) ou período já quitado sem datas */
function LancarFerias({ p, fechar }: { p: PeriodoFerias; fechar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAvisos();
  const [modo, setModo] = useState<"datas" | "quitado">(p.completo && p.dias_ate_limite < 0 ? "quitado" : "datas");
  const [inicio, setInicio] = useState("");
  const [diasGozo, setDiasGozo] = useState(String(Math.min(30, Math.floor(p.saldo_livre))));
  const [abono, setAbono] = useState("0");
  const [obs, setObs] = useState("");
  const nGozo = Number(diasGozo) || 0, nAbono = Number(abono) || 0;
  const fim = inicio && nGozo > 0 ? somaDias(inicio, nGozo - 1) : null;
  const erro = modo === "datas" && (nGozo + nAbono > p.saldo_livre ? `Gozo + abono passam do saldo disponível (${dias(p.saldo_livre)} dias)`
    : nAbono > Math.floor(p.dias_direito / 3) ? `Abono de no máximo ${Math.floor(p.dias_direito / 3)} dias (1/3 do direito)`
    : nGozo > 0 && nGozo < 5 ? "Cada parte das férias tem no mínimo 5 dias" : null);
  const m = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("ferias_lancar", { p: {
        colaborador_id: p.colaborador_id, aquisitivo_inicio: p.aquisitivo_inicio, modo,
        data_inicio: modo === "datas" ? inicio : null, dias: modo === "datas" ? nGozo : null,
        abono: modo === "datas" ? nAbono : null, observacao: obs || null } });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ferias-programacao"] }); qc.invalidateQueries({ queryKey: ["vt"] }); avisar("sucesso", "Férias lançadas."); fechar(); },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  return (
    <Modal aberto aoFechar={fechar} titulo="Lançar férias" descricao={`${p.nome} · período aquisitivo ${data(p.aquisitivo_inicio)} a ${data(p.aquisitivo_fim)} · saldo disponível ${dias(p.saldo_livre)} dias`}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (!erro) m.mutate(); }} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">O que você quer lançar?</legend>
          {([["datas", "Férias com datas", "Programadas (futuras) ou já tiradas. Entram na linha do tempo e descontam do VT."],
             ["quitado", "Período já quitado, sem as datas", "Para quem já tirou essas férias antes do sistema (conforme o relatório da contabilidade)."]] as const).filter(([v]) => v === "datas" || p.completo).map(([v, t, d]) => (
            <label key={v} className={cx("flex cursor-pointer gap-3 rounded-lg border p-3", modo === v ? "border-primaria bg-primaria-suave" : "border-borda")}>
              <input type="radio" name="modo" value={v} checked={modo === v} onChange={() => setModo(v)} className="mt-1 accent-[var(--color-primaria)]" />
              <span><span className="block text-sm font-medium">{t}</span><span className="text-xs text-texto-suave">{d}</span></span>
            </label>
          ))}
        </fieldset>
        {modo === "datas" ? (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Campo rotulo="Início" type="date" obrigatorio value={inicio} onChange={(e) => setInicio(e.target.value)} />
              <Campo rotulo="Dias de descanso" type="number" min={5} max={30} obrigatorio value={diasGozo} onChange={(e) => setDiasGozo(e.target.value)} />
              <Campo rotulo="Abono (dias)" type="number" min={0} max={10} value={abono} onChange={(e) => setAbono(e.target.value)} dica="Dias vendidos, até 1/3" />
            </div>
            {fim && <p className="text-sm">Último dia de férias: <b>{data(fim)}</b> · retorno em <b>{data(somaDias(fim, 1))}</b>
              {nGozo + nAbono < p.saldo_livre && <> · ainda restam <b>{dias(p.saldo_livre - nGozo - nAbono)}</b> dias para outra parte</>}</p>}
            {inicio && inicio > p.limite && <Aviso tom="perigo">O início passa do limite ({data(p.limite)}): as férias terão de ser pagas em dobro.</Aviso>}
            {erro && <Aviso tom="perigo">{erro}</Aviso>}
          </>
        ) : (
          <Aviso tom="info">O período fica com saldo zero e sai dos avisos. Use só quando as férias já foram tiradas ou pagas.</Aviso>
        )}
        <AreaTexto rotulo="Observação" value={obs} onChange={(e) => setObs(e.target.value)} rows={2}
          placeholder={modo === "quitado" ? "Ex.: conforme programação de férias da contabilidade de 28/10/2026" : ""} />
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundaria" onClick={fechar}>Cancelar</Botao>
          <Botao type="submit" carregando={m.isPending} disabled={!!erro || (modo === "datas" && !inicio)}>Salvar</Botao>
        </div>
      </form>
    </Modal>
  );
}

export function Ferias() {
  const [loja, setLoja] = useState("");
  const [filtro, setFiltro] = useState<"" | "vencida" | "urgente" | "a_programar" | "programada">("");
  const lojas = useLojas();
  const { pode } = useAuth();
  const [lancando, setLancando] = useState<PeriodoFerias | null>(null);
  const q = useQuery({
    queryKey: ["ferias-programacao", loja],
    queryFn: async () => {
      const { data: r, error } = await supabase.rpc("ferias_programacao", { p_loja: loja || null });
      if (error) throw new Error(error.message);
      return r as PeriodoFerias[];
    },
  });
  const lista = useMemo(() => [...(q.data ?? [])].sort((a, b) =>
    ordem[a.situacao] - ordem[b.situacao] || a.limite.localeCompare(b.limite) || a.nome.localeCompare(b.nome)), [q.data]);
  const conta = (s: PeriodoFerias["situacao"]) => lista.filter((p) => p.situacao === s).length;
  const visiveis = filtro ? lista.filter((p) => p.situacao === filtro) : lista;
  const alternar = (f: typeof filtro) => setFiltro(filtro === f ? "" : f);

  return (
    <div className="flex flex-col gap-6">
      <CabecalhoPagina titulo="Férias"
        descricao="Períodos aquisitivos em aberto de cada colaborador: direito, saldo, limite para começar a gozar sem pagar em dobro e o que já está programado."
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
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Resumo rotulo="Vencidas" valor={conta("vencida")} icone={CalendarX2} tom="bg-perigo-suave text-perigo" ativo={filtro === "vencida"} onClick={() => alternar("vencida")} />
            <Resumo rotulo="Limite em até 90 dias" valor={conta("urgente")} icone={Hourglass} tom="bg-alerta-suave text-alerta" ativo={filtro === "urgente"} onClick={() => alternar("urgente")} />
            <Resumo rotulo="A programar" valor={conta("a_programar")} icone={CalendarClock} tom="bg-info-suave text-info" ativo={filtro === "a_programar"} onClick={() => alternar("a_programar")} />
            <Resumo rotulo="Programadas" valor={conta("programada")} icone={CalendarCheck2} tom="bg-sucesso-suave text-sucesso" ativo={filtro === "programada"} onClick={() => alternar("programada")} />
          </div>

          <Cartao titulo={filtro ? `${SITUACAO[filtro].rotulo} (${visiveis.length})` : `Programação de férias (${visiveis.length} períodos)`}>
            {visiveis.length === 0 ? <EstadoVazio titulo="Nada aqui" descricao="Nenhum período nessa situação." /> : (
              <>
                {/* celular: cartões */}
                <ul className="flex flex-col divide-y divide-borda md:hidden">
                  {visiveis.map((p) => (
                    <li key={`${p.colaborador_id}-${p.aquisitivo_inicio}`} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link to={`/colaboradores/${p.colaborador_id}`} className="font-medium leading-tight hover:text-primaria hover:underline">{p.nome}</Link>
                          <p className="text-xs text-texto-suave">{p.loja.replace(/^ÓTICAS IDEALIZE /, "")} · aquisitivo {data(p.aquisitivo_inicio)} a {data(p.aquisitivo_fim)}</p>
                        </div>
                        <Selo tom={SITUACAO[p.situacao].tom}>{SITUACAO[p.situacao].rotulo}</Selo>
                      </div>
                      <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                        <div><dt className="text-xs text-texto-suave">Direito</dt><dd className="tabular-nums">{dias(p.dias_direito)}</dd></div>
                        <div><dt className="text-xs text-texto-suave">Saldo</dt><dd className="font-medium tabular-nums">{dias(p.saldo)}</dd></div>
                        <div><dt className="text-xs text-texto-suave">Limite p/ gozo</dt><dd className="tabular-nums">{data(p.limite)}</dd></div>
                      </dl>
                      {p.programado_inicio && (
                        <p className="mt-1 text-xs text-sucesso">Programada: {data(p.programado_inicio)} · {p.programado_dias} dias{p.programado_abono ? ` + ${p.programado_abono} de abono` : ""}</p>
                      )}
                      {pode("ausencia.registrar", p.loja_id) && p.saldo_livre > 0 && (
                        <Botao tamanho="sm" variante="secundaria" className="mt-2" icone={<CalendarPlus className="size-4" />} onClick={() => setLancando(p)}>Lançar férias</Botao>
                      )}
                    </li>
                  ))}
                </ul>
                {/* computador: tabela no formato do relatório da contabilidade */}
                <div className="hidden md:block">
                  <Tabela cabecalho={["Colaborador", "Período aquisitivo", "Direito", "Gozados", "Saldo", "Limite p/ gozo", "Programação", ""]}>
                    {visiveis.map((p) => (
                      <tr key={`${p.colaborador_id}-${p.aquisitivo_inicio}`} className="align-top hover:bg-fundo">
                        <td className="min-w-56 px-4 py-3">
                          <Link to={`/colaboradores/${p.colaborador_id}`} className="font-medium hover:text-primaria hover:underline">{p.nome}</Link>
                          <p className="mb-1.5 text-xs text-texto-suave">{p.loja.replace(/^ÓTICAS IDEALIZE /, "")} · admissão {data(p.admissao)}</p>
                          <Selo tom={SITUACAO[p.situacao].tom}>{SITUACAO[p.situacao].rotulo}</Selo>
                        </td>
                        <td className="px-4 py-3 tabular-nums whitespace-nowrap">{data(p.aquisitivo_inicio)} a {data(p.aquisitivo_fim)}
                          {!p.completo && <p className="text-xs text-texto-suave">em andamento</p>}</td>
                        <td className="px-4 py-3 tabular-nums">{dias(p.dias_direito)}</td>
                        <td className="px-4 py-3 tabular-nums">{p.dias_gozados + p.abono || "—"}{p.abono > 0 && <p className="text-xs text-texto-suave">{p.abono} abono</p>}</td>
                        <td className="px-4 py-3 font-medium tabular-nums">{dias(p.saldo)}</td>
                        <td className="px-4 py-3 tabular-nums whitespace-nowrap">{data(p.limite)}
                          {p.completo && p.situacao !== "programada" && <p className="text-xs text-texto-suave">{p.dias_ate_limite < 0 ? `venceu há ${-p.dias_ate_limite} dias` : `em ${p.dias_ate_limite} dias`}</p>}</td>
                        <td className="px-4 py-3 text-sm">{p.programado_inicio
                          ? <><span className="tabular-nums">{data(p.programado_inicio)}</span><p className="text-xs text-texto-suave">{p.programado_dias} dias{p.programado_abono ? ` + ${p.programado_abono} abono` : ""}</p></>
                          : "—"}</td>
                        <td className="px-4 py-3 text-right">
                          {pode("ausencia.registrar", p.loja_id) && p.saldo_livre > 0 && (
                            <Botao tamanho="sm" variante="secundaria" icone={<CalendarPlus className="size-4" />} onClick={() => setLancando(p)}>Lançar</Botao>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Tabela>
                </div>
              </>
            )}
          </Cartao>
          {lancando && <LancarFerias p={lancando} fechar={() => setLancando(null)} />}
          <p className="text-xs text-texto-suave">
            Direito: 2,5 dias por mês trabalhado no período (30 no período completo). Limite p/ gozo: último dia para começar o saldo dentro do período concessivo — depois disso as férias são pagas em dobro.
          </p>
        </>
      )}
    </div>
  );
}
