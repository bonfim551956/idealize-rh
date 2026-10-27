import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Tabs from "@radix-ui/react-tabs";
import { Ban, CalendarX2, Download, Lock, Pencil, Plus } from "lucide-react";
import { mensagemErro, supabase } from "../lib/supabase";
import { falhar, useLojas } from "../lib/dados";
import { data, dataHora, type Tom } from "../lib/formato";
import { useAuth } from "../auth/AuthProvider";
import { AreaTexto, Aviso, Botao, CabecalhoPagina, Campo, Cartao, Carregando, EstadoErro, EstadoVazio, Modal, Selecao, Selo, Tabela, cx, useAvisos } from "../ui/componentes";

/* ---------------- Tipos ---------------- */
type Calculo = {
  colaborador_id: string; nome: string; loja_id: string; loja: string; cargo: string | null;
  situacao: "recebe" | "nao_recebe" | "sem_cadastro"; valor_diario: number | null;
  periodo_inicio: string; periodo_fim: string; dias_base: number; dias_excluidos: number;
  ausencias_mes_anterior: number; ja_descontado: number; dias_desconto_anterior: number;
  dias_pagar: number; valor: number; fechado: boolean; fechado_dias: number | null; fechado_valor: number | null;
  observacao: string | null;
};
type Ausencia = {
  id: string; colaborador_id: string; nome: string; loja_id: string; loja: string;
  tipo: TipoAusencia; data_inicio: string; data_fim: string; horario: string | null; aquisitivo_inicio: string | null;
  observacao: string | null; cancelada: boolean; cancelada_motivo: string | null; criado_em: string; dias_vt: number;
};
type TipoAusencia = "falta_injustificada" | "atestado" | "afastamento" | "licenca" | "ferias" | "declaracao_horas";
type Colab = { id: string; nome_completo: string; loja_nome: string; loja_atual_id: string; status: string | null };

export const TIPOS_AUSENCIA: Record<TipoAusencia, { rotulo: string; tom: Tom; desconta: boolean }> = {
  falta_injustificada: { rotulo: "Falta injustificada", tom: "perigo", desconta: true },
  atestado: { rotulo: "Atestado", tom: "alerta", desconta: true },
  afastamento: { rotulo: "Afastamento", tom: "alerta", desconta: true },
  licenca: { rotulo: "Licença", tom: "info", desconta: true },
  ferias: { rotulo: "Férias", tom: "sucesso", desconta: true },
  declaracao_horas: { rotulo: "Declaração de horas", tom: "neutro", desconta: false },
};

const moeda = (v: number | null | undefined) => (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const mesAtual = () => new Date().toISOString().slice(0, 7);
const proximoMes = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 7); };
const nomeMes = (m: string) => new Date(`${m}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
const mesAnterior = (m: string) => { const d = new Date(`${m}-01T12:00:00`); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };

function useColabs() {
  return useQuery({
    queryKey: ["vt", "colaboradores"],
    queryFn: async () => falhar(await supabase.from("v_colaboradores").select("id,nome_completo,loja_nome,loja_atual_id,status")
      .not("status", "in", "(desligado,arquivado)").order("nome_completo")) as Colab[],
  });
}

/* ---------------- Página ---------------- */
export function ValeTransporte() {
  const { pode } = useAuth();
  const lojas = useLojas();
  const [loja, setLoja] = useState("");
  const [mes, setMes] = useState(proximoMes());
  const veVT = pode("vt.ler");
  const veAus = pode("ausencia.ler");

  return (
    <>
      <CabecalhoPagina titulo="Vale-transporte e ausências"
        descricao="VT pago antecipado: o mês paga os dias de segunda a sábado (menos 25/12 e 01/01) e desconta as faltas, atestados, afastamentos, licenças e férias do mês anterior."
        acoes={(lojas.data?.length ?? 0) > 1 && (
          <Selecao rotulo="Loja" value={loja} onChange={(e) => setLoja(e.target.value)} className="w-56">
            <option value="">Todas as lojas</option>
            {lojas.data!.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </Selecao>
        )} />
      <Tabs.Root defaultValue={veVT ? "calculo" : "ausencias"}>
        <Tabs.List className="mb-6 flex gap-1 overflow-x-auto border-b border-borda" aria-label="Seções">
          {([veVT && ["calculo", "Cálculo do mês"], veVT && ["cadastro", "Cadastro do VT"], veAus && ["ausencias", "Ausências"]].filter(Boolean) as string[][]).map(([v, r]) => (
            <Tabs.Trigger key={v} value={v}
              className="h-10 shrink-0 border-b-2 border-transparent px-3 text-sm font-medium text-texto-suave hover:text-texto data-[state=active]:border-primaria data-[state=active]:text-primaria">{r}</Tabs.Trigger>
          ))}
        </Tabs.List>
        {veVT && <Tabs.Content value="calculo"><CalculoMes mes={mes} setMes={setMes} loja={loja} /></Tabs.Content>}
        {veVT && <Tabs.Content value="cadastro"><CadastroVT loja={loja} /></Tabs.Content>}
        {veAus && <Tabs.Content value="ausencias"><Ausencias loja={loja} /></Tabs.Content>}
      </Tabs.Root>
    </>
  );
}

/* ---------------- Cálculo do mês ---------------- */
function CalculoMes({ mes, setMes, loja }: { mes: string; setMes: (m: string) => void; loja: string }) {
  const { pode } = useAuth();
  const qc = useQueryClient();
  const avisar = useAvisos();
  const [confirmar, setConfirmar] = useState(false);
  const q = useQuery({
    queryKey: ["vt", "calculo", mes, loja],
    queryFn: async () => {
      const { data: r, error } = await supabase.rpc("vt_calculo", { p_mes: `${mes}-01`, p_loja: loja || null });
      if (error) throw new Error(error.message);
      return r as Calculo[];
    },
  });
  const linhas = q.data ?? [];
  const recebem = linhas.filter((l) => l.situacao === "recebe");
  const semCadastro = linhas.filter((l) => l.situacao === "sem_cadastro");
  const fechado = recebem.length > 0 && recebem.every((l) => l.fechado);
  const total = recebem.reduce((s, l) => s + Number(l.valor), 0);
  const porLoja = useMemo(() => {
    const m = new Map<string, number>();
    recebem.forEach((l) => m.set(l.loja, (m.get(l.loja) ?? 0) + Number(l.valor)));
    return [...m.entries()];
  }, [recebem]);

  const fechar = useMutation({
    mutationFn: async () => {
      const { data: n, error } = await supabase.rpc("vt_fechar", { p_mes: `${mes}-01`, p_loja: loja || null, p_refazer: fechado });
      if (error) throw error;
      return n as number;
    },
    onSuccess: (n) => { qc.invalidateQueries({ queryKey: ["vt"] }); setConfirmar(false); avisar("sucesso", `Mês fechado: ${n} colaboradores.`); },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });

  const exportar = () => {
    const cab = ["Loja", "Colaborador", "Cargo", "Valor diário", "Dias do mês", "Férias/afast. no mês", "Ausências mês anterior", "Já descontado", "Desconto", "Dias a pagar", "Valor"];
    const fmt = (n: number | null) => (n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const rows = recebem.map((l) => [l.loja, l.nome, l.cargo ?? "", fmt(l.valor_diario), l.dias_base, l.dias_excluidos, l.ausencias_mes_anterior, l.ja_descontado, l.dias_desconto_anterior, l.dias_pagar, fmt(l.valor)]);
    rows.push(["", "TOTAL", "", "", "", "", "", "", "", "", fmt(total)]);
    const csv = [cab, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `vale-transporte-${mes}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Campo rotulo="Mês do pagamento" type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className="w-48" />
        <div className="flex flex-wrap gap-2">
          <Botao variante="secundaria" icone={<Download className="size-4" />} onClick={exportar} disabled={!recebem.length}>Exportar (Excel)</Botao>
          {pode("vt.gerir") && <Botao icone={<Lock className="size-4" />} onClick={() => setConfirmar(true)} disabled={!recebem.length}>
            {fechado ? "Refazer fechamento" : "Fechar mês"}</Botao>}
        </div>
      </div>

      {q.isLoading && <Carregando />}
      {q.error && <EstadoErro mensagem={(q.error as Error).message} tentarNovamente={() => q.refetch()} />}
      {q.data && <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Numero rotulo={`Total a pagar · ${nomeMes(mes)}`} valor={moeda(total)} />
          <Numero rotulo="Recebem VT" valor={String(recebem.length)} />
          <Numero rotulo="Sem cadastro de VT" valor={String(semCadastro.length)} tom={semCadastro.length ? "alerta" : undefined} />
          <Numero rotulo="Situação" valor={fechado ? "Fechado" : "Prévia"} tom={fechado ? "sucesso" : "alerta"} />
        </div>
        {semCadastro.length > 0 && (
          <Aviso tom="alerta">Sem cadastro de VT: {semCadastro.map((s) => s.nome).join(", ")}. Informe na aba “Cadastro do VT” se recebe e o valor diário.</Aviso>
        )}
        {porLoja.length > 1 && (
          <div className="flex flex-wrap gap-2">{porLoja.map(([l, v]) => <Selo key={l}>{l}: {moeda(v)}</Selo>)}</div>
        )}
        <Cartao>
          {recebem.length === 0 ? <EstadoVazio titulo="Ninguém com VT neste mês" descricao="Cadastre o valor diário na aba “Cadastro do VT”." /> : (
            <Tabela cabecalho={["Colaborador", "R$/dia", "Dias do mês", "Férias/afast. no mês", `Desconto de ${nomeMes(mesAnterior(mes)).split(" ")[0]}`, "Dias a pagar", "Valor"]}>
              {recebem.map((l) => (
                <tr key={l.colaborador_id} className="align-top hover:bg-fundo">
                  <td className="px-4 py-3">
                    <Link to={`/colaboradores/${l.colaborador_id}`} className="font-medium hover:text-primaria hover:underline">{l.nome}</Link>
                    <p className="text-xs text-texto-suave">{l.loja}{l.cargo ? ` · ${l.cargo}` : ""}</p>
                    {(l.periodo_inicio !== `${mes}-01`) && <p className="text-xs text-texto-suave">A partir de {data(l.periodo_inicio)}</p>}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{moeda(l.valor_diario)}</td>
                  <td className="px-4 py-3 tabular-nums">{l.dias_base}</td>
                  <td className="px-4 py-3 tabular-nums">{l.dias_excluidos ? `−${l.dias_excluidos}` : "—"}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {l.dias_desconto_anterior ? `−${l.dias_desconto_anterior}` : "—"}
                    {l.ja_descontado > 0 && <p className="text-xs text-texto-suave">{l.ja_descontado} já tirado(s) antes</p>}
                  </td>
                  <td className="px-4 py-3 font-medium tabular-nums">{l.dias_pagar}</td>
                  <td className="px-4 py-3 font-medium tabular-nums">
                    {moeda(l.valor)}
                    {l.fechado && Number(l.fechado_valor) !== Number(l.valor) && (
                      <p className="text-xs text-alerta">Fechado: {moeda(l.fechado_valor)} ({l.fechado_dias} dias)</p>
                    )}
                  </td>
                </tr>
              ))}
            </Tabela>
          )}
        </Cartao>
        <p className="text-xs text-texto-suave">
          “Férias/afast. no mês” são férias, afastamentos e licenças já registrados para este mês (saem do próprio mês).
          “Desconto” são as ausências do mês anterior que ainda não tinham sido tiradas. Declaração de horas não desconta.
        </p>
      </>}

      <Modal aberto={confirmar} aoFechar={() => setConfirmar(false)} titulo={fechado ? "Refazer fechamento" : `Fechar ${nomeMes(mes)}`}
        descricao="O fechamento grava os dias e valores que serão pagos. Ele é usado no mês seguinte para não descontar a mesma ausência duas vezes.">
        <div className="flex flex-col gap-4">
          <p className="text-sm">Total: <b>{moeda(total)}</b> para <b>{recebem.length}</b> colaboradores{loja ? " desta loja" : ""}.</p>
          {fechado && <Aviso tom="alerta">Este mês já foi fechado. O novo fechamento substitui o anterior (fica na auditoria).</Aviso>}
          <div className="flex justify-end gap-2">
            <Botao variante="secundaria" onClick={() => setConfirmar(false)}>Cancelar</Botao>
            <Botao carregando={fechar.isPending} onClick={() => fechar.mutate()}>{fechado ? "Refazer" : "Fechar mês"}</Botao>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Numero({ rotulo, valor, tom }: { rotulo: string; valor: string; tom?: Tom }) {
  const cor = tom === "alerta" ? "text-alerta" : tom === "sucesso" ? "text-sucesso" : "text-texto";
  return (
    <div className="rounded-xl border border-borda bg-superficie p-4">
      <p className="text-xs text-texto-suave first-letter:uppercase">{rotulo}</p>
      <p className={cx("mt-1 text-2xl font-semibold tabular-nums", cor)}>{valor}</p>
    </div>
  );
}

/* ---------------- Cadastro do VT ---------------- */
type CadastroLinha = { colaborador_id: string; recebe: boolean; valor_diario: number | null; observacao: string | null; atualizado_em: string };

function CadastroVT({ loja }: { loja: string }) {
  const { pode } = useAuth();
  const colabs = useColabs();
  const cad = useQuery({
    queryKey: ["vt", "cadastros"],
    queryFn: async () => falhar(await supabase.from("vt_cadastros").select("colaborador_id,recebe,valor_diario,observacao,atualizado_em")) as CadastroLinha[],
  });
  const [editando, setEditando] = useState<Colab | null>(null);
  const mapa = new Map((cad.data ?? []).map((c) => [c.colaborador_id, c]));
  const lista = (colabs.data ?? []).filter((c) => !loja || c.loja_atual_id === loja);

  if (colabs.isLoading || cad.isLoading) return <Carregando />;
  if (colabs.error || cad.error) return <EstadoErro mensagem={((colabs.error ?? cad.error) as Error).message} />;
  return (
    <Cartao>
      <Tabela cabecalho={["Colaborador", "Recebe VT", "Valor diário", "Observação", ""]}>
        {lista.map((c) => {
          const v = mapa.get(c.id);
          return (
            <tr key={c.id} className="hover:bg-fundo">
              <td className="px-4 py-3"><p className="font-medium">{c.nome_completo}</p><p className="text-xs text-texto-suave">{c.loja_nome}</p></td>
              <td className="px-4 py-3">{!v ? <Selo tom="alerta">Sem cadastro</Selo> : v.recebe ? <Selo tom="sucesso">Sim</Selo> : <Selo>Não</Selo>}</td>
              <td className="px-4 py-3 tabular-nums">{v?.recebe ? moeda(v.valor_diario) : "—"}</td>
              <td className="px-4 py-3 text-xs text-texto-suave">{v?.observacao ?? ""}</td>
              <td className="px-4 py-3 text-right">
                {pode("vt.gerir", c.loja_atual_id) && <Botao tamanho="sm" variante="secundaria" icone={<Pencil className="size-4" />} onClick={() => setEditando(c)}>Editar</Botao>}
              </td>
            </tr>
          );
        })}
      </Tabela>
      {editando && <EditarVT c={editando} atual={mapa.get(editando.id)} fechar={() => setEditando(null)} />}
    </Cartao>
  );
}

function EditarVT({ c, atual, fechar }: { c: Colab; atual?: CadastroLinha; fechar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAvisos();
  const [recebe, setRecebe] = useState(atual?.recebe ?? true);
  const [valor, setValor] = useState(atual?.valor_diario != null ? String(atual.valor_diario).replace(".", ",") : "");
  const [obs, setObs] = useState(atual?.observacao ?? "");
  const num = Number(valor.replace(/\./g, "").replace(",", "."));
  const m = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("vt_salvar", { p_colaborador: c.id, p_recebe: recebe, p_valor_diario: recebe ? num : null, p_observacao: obs || null });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vt"] }); avisar("sucesso", "VT salvo."); fechar(); },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  return (
    <Modal aberto aoFechar={fechar} titulo="Vale-transporte" descricao={c.nome_completo}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        <Selecao rotulo="Recebe VT?" value={recebe ? "sim" : "nao"} onChange={(e) => setRecebe(e.target.value === "sim")}>
          <option value="sim">Sim</option>
          <option value="nao">Não (ex.: home office, não optante)</option>
        </Selecao>
        {recebe && <Campo rotulo="Valor diário (R$)" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value.replace(/[^\d,.]/g, ""))}
          obrigatorio dica="Ida e volta por dia. Ex.: 10,60" />}
        <AreaTexto rotulo="Observação" value={obs} onChange={(e) => setObs(e.target.value)} rows={2} />
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundaria" onClick={fechar}>Cancelar</Botao>
          <Botao type="submit" carregando={m.isPending} disabled={recebe && !(num > 0)}>Salvar</Botao>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- Ausências ---------------- */
function Ausencias({ loja }: { loja: string }) {
  const { pode } = useAuth();
  const [mes, setMes] = useState(mesAtual());
  const [novo, setNovo] = useState(false);
  const [cancelando, setCancelando] = useState<Ausencia | null>(null);
  const [mostrarCanceladas, setMostrarCanceladas] = useState(false);
  const ini = `${mes}-01`;
  const fim = new Date(new Date(`${mes}-01T12:00:00`).setMonth(new Date(`${mes}-01T12:00:00`).getMonth() + 1) - 864e5).toISOString().slice(0, 10);
  const q = useQuery({
    queryKey: ["vt", "ausencias", mes, loja],
    queryFn: async () => {
      let r = supabase.from("v_ausencias").select("*").lte("data_inicio", fim).gte("data_fim", ini).order("data_inicio");
      if (loja) r = r.eq("loja_id", loja);
      return falhar(await r) as Ausencia[];
    },
  });
  const lista = (q.data ?? []).filter((a) => mostrarCanceladas || !a.cancelada);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Campo rotulo="Mês" type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className="w-48" />
          <label className="flex h-10 items-center gap-2 text-sm text-texto-suave">
            <input type="checkbox" checked={mostrarCanceladas} onChange={(e) => setMostrarCanceladas(e.target.checked)} className="size-4 accent-primaria" />
            Mostrar canceladas
          </label>
        </div>
        {pode("ausencia.registrar") && <Botao icone={<Plus className="size-4" />} onClick={() => setNovo(true)}>Registrar ausência</Botao>}
      </div>
      {q.isLoading && <Carregando />}
      {q.error && <EstadoErro mensagem={(q.error as Error).message} tentarNovamente={() => q.refetch()} />}
      {q.data && (
        <Cartao>
          {lista.length === 0 ? <EstadoVazio titulo={`Nenhuma ausência em ${nomeMes(mes)}`} /> : (
            <Tabela cabecalho={["Colaborador", "Tipo", "Período", "Dias (VT)", "Observação", ""]}>
              {lista.map((a) => (
                <tr key={a.id} className={cx("align-top hover:bg-fundo", a.cancelada && "opacity-60")}>
                  <td className="px-4 py-3"><Link to={`/colaboradores/${a.colaborador_id}`} className="font-medium hover:text-primaria hover:underline">{a.nome}</Link>
                    <p className="text-xs text-texto-suave">{a.loja}</p></td>
                  <td className="px-4 py-3"><Selo tom={TIPOS_AUSENCIA[a.tipo].tom}>{TIPOS_AUSENCIA[a.tipo].rotulo}</Selo>
                    {a.cancelada && <p className="mt-1 text-xs text-perigo">Cancelada: {a.cancelada_motivo}</p>}</td>
                  <td className="px-4 py-3 tabular-nums">{a.data_inicio === a.data_fim ? data(a.data_inicio) : `${data(a.data_inicio)} a ${data(a.data_fim)}`}
                    {a.horario && <p className="text-xs text-texto-suave">{a.horario}</p>}</td>
                  <td className="px-4 py-3 tabular-nums">{TIPOS_AUSENCIA[a.tipo].desconta ? a.dias_vt : "não desconta"}</td>
                  <td className="px-4 py-3 text-xs text-texto-suave">{a.observacao ?? ""}{a.aquisitivo_inicio && <><br />Aquisitivo desde {data(a.aquisitivo_inicio)}</>}
                    <br /><span>Registrado em {dataHora(a.criado_em)}</span></td>
                  <td className="px-4 py-3 text-right">
                    {!a.cancelada && pode("ausencia.registrar", a.loja_id) &&
                      <Botao tamanho="sm" variante="fantasma" icone={<Ban className="size-4" />} onClick={() => setCancelando(a)}>Cancelar</Botao>}
                  </td>
                </tr>
              ))}
            </Tabela>
          )}
        </Cartao>
      )}
      {novo && <NovaAusencia fechar={() => setNovo(false)} />}
      {cancelando && <CancelarAusencia a={cancelando} fechar={() => setCancelando(null)} />}
    </div>
  );
}

export function NovaAusencia({ fechar, colaboradorFixo }: { fechar: () => void; colaboradorFixo?: { id: string; nome: string } }) {
  const qc = useQueryClient();
  const avisar = useAvisos();
  const colabs = useColabs();
  const [f, setF] = useState({ colaborador_id: colaboradorFixo?.id ?? "", tipo: "atestado" as TipoAusencia, data_inicio: "", data_fim: "", horario: "", aquisitivo_inicio: "", observacao: "" });
  const umDia = f.tipo === "declaracao_horas" || f.tipo === "falta_injustificada";
  const m = useMutation({
    mutationFn: async () => {
      const p = { ...f, data_fim: umDia ? f.data_inicio : (f.data_fim || f.data_inicio) };
      const { error } = await supabase.rpc("ausencia_registrar", { p: Object.fromEntries(Object.entries(p).filter(([, v]) => v)) });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vt"] }); qc.invalidateQueries({ queryKey: ["timeline"] }); qc.invalidateQueries({ queryKey: ["painel-avisos"] }); avisar("sucesso", "Ausência registrada."); fechar(); },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  const valido = f.colaborador_id && f.data_inicio && (umDia || !f.data_fim || f.data_fim >= f.data_inicio) && (f.tipo !== "ferias" || f.aquisitivo_inicio);
  return (
    <Modal aberto aoFechar={fechar} titulo="Registrar ausência" descricao="Faltas, atestados, afastamentos, licenças e férias tiram dias do VT. Declaração de horas fica só registrada.">
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        {colaboradorFixo ? <p className="text-sm"><b>{colaboradorFixo.nome}</b></p> : (
          <Selecao rotulo="Colaborador" obrigatorio value={f.colaborador_id} onChange={(e) => setF({ ...f, colaborador_id: e.target.value })}>
            <option value="">Selecione…</option>
            {colabs.data?.map((c) => <option key={c.id} value={c.id}>{c.nome_completo} · {c.loja_nome}</option>)}
          </Selecao>
        )}
        <Selecao rotulo="Tipo" obrigatorio value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as TipoAusencia })}>
          {Object.entries(TIPOS_AUSENCIA).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}
        </Selecao>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo={umDia ? "Data" : "Início"} type="date" obrigatorio value={f.data_inicio} onChange={(e) => setF({ ...f, data_inicio: e.target.value })} />
          {!umDia && <Campo rotulo="Fim" type="date" value={f.data_fim} min={f.data_inicio} onChange={(e) => setF({ ...f, data_fim: e.target.value })} dica="Vazio = um dia" />}
          {f.tipo === "declaracao_horas" && <Campo rotulo="Horário" value={f.horario} onChange={(e) => setF({ ...f, horario: e.target.value })} dica="Ex.: 15H10 ÀS 16H" />}
        </div>
        {f.tipo === "ferias" && <Campo rotulo="Início do período aquisitivo" type="date" obrigatorio value={f.aquisitivo_inicio}
          onChange={(e) => setF({ ...f, aquisitivo_inicio: e.target.value })} dica="Usado no aviso de férias a vencer do painel." />}
        {(f.tipo === "atestado" || f.tipo === "afastamento" || f.tipo === "licenca") &&
          <Aviso tom="info">Não escreva diagnóstico nem CID. O documento vai em Documentos (categoria Atestados médicos ou Afastamentos e licenças).</Aviso>}
        <AreaTexto rotulo="Observação" value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} rows={2} />
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundaria" onClick={fechar}>Cancelar</Botao>
          <Botao type="submit" icone={<CalendarX2 className="size-4" />} carregando={m.isPending} disabled={!valido}>Registrar</Botao>
        </div>
      </form>
    </Modal>
  );
}

function CancelarAusencia({ a, fechar }: { a: Ausencia; fechar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAvisos();
  const [motivo, setMotivo] = useState("");
  const m = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc("ausencia_cancelar", { p_id: a.id, p_motivo: motivo }); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vt"] }); avisar("sucesso", "Ausência cancelada."); fechar(); },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  return (
    <Modal aberto aoFechar={fechar} titulo="Cancelar ausência" descricao={`${a.nome} · ${TIPOS_AUSENCIA[a.tipo].rotulo} · ${data(a.data_inicio)}`}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        <AreaTexto rotulo="Motivo" obrigatorio value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} />
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundaria" onClick={fechar}>Voltar</Botao>
          <Botao type="submit" variante="perigo" carregando={m.isPending} disabled={motivo.trim().length < 3}>Cancelar ausência</Botao>
        </div>
      </form>
    </Modal>
  );
}
