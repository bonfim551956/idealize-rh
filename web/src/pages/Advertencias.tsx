import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, CalendarClock, FileSignature, Gavel, Plus, Printer, Repeat2, Settings2, Trash2, Upload, type LucideIcon } from "lucide-react";
import { chamarFuncao, mensagemErro, supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import { falhar, useCategorias, useLojas, type ColaboradorLinha } from "../lib/dados";
import { data, hoje } from "../lib/formato";
import { AreaTexto, Aviso, Botao, CabecalhoPagina, Campo, Cartao, Carregando, EstadoErro, EstadoVazio, Modal, Selecao, Selo, Tabela, cx, useAvisos } from "../ui/componentes";
import { BuscaColaborador } from "./EnvioDocumentos";
import { carregarLogo, esc, imprimir, pagina } from "./Termos";

export type Advertencia = {
  id: string; colaborador_id: string; colaborador_nome: string; loja_id: string; loja_nome: string | null; cargo_nome: string | null;
  cpf: string | null; tipo: "verbal" | "escrita" | "suspensao"; dias_suspensao: number | null; data_ocorrencia: string; data_aplicacao: string;
  motivo: string; descricao: string; testemunhas: string | null; situacao: "aguardando" | "assinada" | "recusou";
  documento_id: string | null; registrado_por_nome: string | null; anteriores_90d: number;
};

const TIPO: Record<Advertencia["tipo"], { rotulo: string; tom: "info" | "alerta" | "perigo" }> = {
  verbal: { rotulo: "Verbal", tom: "info" }, escrita: { rotulo: "Escrita", tom: "alerta" }, suspensao: { rotulo: "Suspensão", tom: "perigo" },
};
const SITUACAO: Record<Advertencia["situacao"], { rotulo: string; tom: "sucesso" | "alerta" | "neutro" }> = {
  assinada: { rotulo: "Assinada", tom: "sucesso" }, aguardando: { rotulo: "Aguardando assinatura", tom: "alerta" }, recusou: { rotulo: "Recusou assinar (testemunhas)", tom: "neutro" },
};
const rotuloTipo = (a: Pick<Advertencia, "tipo" | "dias_suspensao">) => a.tipo === "suspensao" ? `Suspensão · ${a.dias_suspensao} dia(s)` : TIPO[a.tipo].rotulo;

export function useMotivosAdvertencia() {
  return useQuery({
    queryKey: ["advertencia-motivos"],
    queryFn: async () => falhar(await supabase.from("advertencia_motivos").select("id,nome,ativo").order("nome")) as { id: string; nome: string; ativo: boolean }[],
  });
}

function Indicador({ rotulo, valor, icone: Icone, tom }: { rotulo: string; valor: number; icone: LucideIcon; tom: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-borda bg-superficie p-4">
      <span className={cx("inline-flex size-10 shrink-0 items-center justify-center rounded-full", tom)}><Icone className="size-5" aria-hidden /></span>
      <span><span className="block text-2xl font-bold leading-tight tabular-nums">{valor}</span><span className="text-sm text-texto-suave">{rotulo}</span></span>
    </div>
  );
}

/* ---------------- Página ---------------- */
export function Advertencias() {
  const { pode, permissoes } = useAuth();
  const lojas = useLojas();
  const [loja, setLoja] = useState("");
  const [busca, setBusca] = useState("");
  const [nova, setNova] = useState(false);
  const [motivos, setMotivos] = useState(false);
  const podeRegistrar = permissoes.some((p) => p.permissao === "documento.disciplinar.enviar" && p.liberada_na_sessao);
  const q = useQuery({
    queryKey: ["advertencias", loja],
    queryFn: async () => {
      const { data: r, error } = await supabase.rpc("advertencias_listar", { p_loja: loja || null, p_colaborador: null });
      if (error) throw new Error(error.message);
      return r as Advertencia[];
    },
  });
  const lista = (q.data ?? []).filter((a) => !busca || a.colaborador_nome.toLowerCase().includes(busca.toLowerCase()) || a.motivo.toLowerCase().includes(busca.toLowerCase()));
  const todos = q.data ?? [];
  const mes = hoje().slice(0, 7);
  const d90 = new Date(Date.now() - 90 * 86400e3).toISOString().slice(0, 10);
  const reincidentes = new Set(todos.filter((a) => a.data_ocorrencia >= d90).map((a) => a.colaborador_id)
    .filter((id, _, arr) => arr.filter((x) => x === id).length >= 2)).size;

  return (
    <div className="flex flex-col gap-6">
      <CabecalhoPagina titulo="Advertências"
        descricao="Advertências verbais, escritas e suspensões, com motivo, data e o termo assinado. Sigiloso: só quem tem acesso a documentos disciplinares."
        acoes={<div className="flex flex-wrap items-end gap-2">
          {(lojas.data?.length ?? 0) > 1 && (
            <Selecao rotulo="Loja" value={loja} onChange={(e) => setLoja(e.target.value)} className="w-56">
              <option value="">Todas as lojas</option>
              {lojas.data!.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </Selecao>
          )}
          {pode("config.estrutura.gerir") && <Botao variante="secundaria" icone={<Settings2 className="size-4" />} onClick={() => setMotivos(true)}>Motivos</Botao>}
          {podeRegistrar && <Botao icone={<Plus className="size-4" />} onClick={() => setNova(true)}>Nova advertência</Botao>}
        </div>} />

      {q.isLoading && <Carregando />}
      {q.error && <EstadoErro mensagem={(q.error as Error).message} tentarNovamente={() => q.refetch()} />}
      {q.data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Indicador rotulo="Neste mês" valor={todos.filter((a) => a.data_ocorrencia.startsWith(mes)).length} icone={Gavel} tom="bg-info-suave text-info" />
            <Indicador rotulo="Suspensões (90 dias)" valor={todos.filter((a) => a.tipo === "suspensao" && a.data_ocorrencia >= d90).length} icone={Ban} tom="bg-perigo-suave text-perigo" />
            <Indicador rotulo="Reincidentes (2+ em 90 dias)" valor={reincidentes} icone={Repeat2} tom="bg-alerta-suave text-alerta" />
            <Indicador rotulo="Aguardando assinatura" valor={todos.filter((a) => a.situacao === "aguardando").length} icone={CalendarClock} tom="bg-alerta-suave text-alerta" />
          </div>
          <Cartao titulo={`Registros (${lista.length})`} acao={<Campo rotulo="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou motivo" className="w-56" />}>
            {lista.length === 0 ? <EstadoVazio titulo="Nenhuma advertência" descricao="Nada registrado com esse filtro." /> : <ListaAdvertencias lista={lista} mostrarColaborador />}
          </Cartao>
        </>
      )}
      {nova && <NovaAdvertencia fechar={() => setNova(false)} />}
      {motivos && <GerenciarMotivos fechar={() => setMotivos(false)} />}
    </div>
  );
}

/* ---------------- Lista (página e ficha) ---------------- */
export function ListaAdvertencias({ lista, mostrarColaborador }: { lista: Advertencia[]; mostrarColaborador?: boolean }) {
  const { permissoes } = useAuth();
  const [anexar, setAnexar] = useState<Advertencia | null>(null);
  const [cancelar, setCancelar] = useState<Advertencia | null>(null);
  const podeRegistrar = permissoes.some((p) => p.permissao === "documento.disciplinar.enviar" && p.liberada_na_sessao);
  return (
    <>
      <Tabela cabecalho={[...(mostrarColaborador ? ["Colaborador"] : []), "Data", "Tipo", "Motivo", "Situação", ""]}>
        {lista.map((a) => (
          <tr key={a.id} className="align-top hover:bg-fundo">
            {mostrarColaborador && (
              <td className="px-4 py-3">
                <Link to={`/colaboradores/${a.colaborador_id}?aba=advertencias`} className="font-medium hover:text-primaria hover:underline">{a.colaborador_nome}</Link>
                <p className="text-xs text-texto-suave">{a.loja_nome?.replace(/^ÓTICAS IDEALIZE /, "")}{a.anteriores_90d > 0 && <span className="text-alerta"> · {a.anteriores_90d} anterior(es) em 90 dias</span>}</p>
              </td>
            )}
            <td className="whitespace-nowrap px-4 py-3 tabular-nums">{data(a.data_ocorrencia)}</td>
            <td className="px-4 py-3"><Selo tom={TIPO[a.tipo].tom}>{rotuloTipo(a)}</Selo></td>
            <td className="max-w-md px-4 py-3"><p className="font-medium">{a.motivo}</p><p className="line-clamp-2 text-xs text-texto-suave">{a.descricao}</p></td>
            <td className="px-4 py-3"><Selo tom={SITUACAO[a.situacao].tom}>{SITUACAO[a.situacao].rotulo}</Selo></td>
            <td className="px-4 py-3">
              <div className="flex justify-end gap-1">
                <Botao tamanho="sm" variante="fantasma" aria-label="Gerar termo de advertência" icone={<Printer className="size-4" />} onClick={() => gerarTermoAdvertencia(a)} />
                {podeRegistrar && a.situacao === "aguardando" && (
                  <Botao tamanho="sm" variante="secundaria" icone={<Upload className="size-4" />} onClick={() => setAnexar(a)}>Anexar</Botao>
                )}
                {podeRegistrar && <Botao tamanho="sm" variante="fantasma" aria-label="Cancelar registro" icone={<Trash2 className="size-4" />} onClick={() => setCancelar(a)} />}
              </div>
            </td>
          </tr>
        ))}
      </Tabela>
      {anexar && <AnexarAssinada a={anexar} fechar={() => setAnexar(null)} />}
      {cancelar && <CancelarAdvertencia a={cancelar} fechar={() => setCancelar(null)} />}
    </>
  );
}

/* ---------------- Nova advertência ---------------- */
type Colab = Pick<ColaboradorLinha, "id" | "nome_completo" | "loja_atual_id" | "loja_nome">;
export function NovaAdvertencia({ fixo, fechar }: { fixo?: Colab; fechar: () => void }) {
  const qc = useQueryClient(); const avisar = useAvisos();
  const motivos = useMotivosAdvertencia();
  const colabs = useQuery({
    queryKey: ["colaboradores-advertencia"], enabled: !fixo,
    queryFn: async () => falhar(await supabase.from("v_colaboradores").select("id,nome_completo,loja_atual_id,loja_nome")
      .in("status", ["ativo", "em_ferias", "afastado", "em_licenca", "em_desligamento"]).order("nome_completo")) as Colab[],
  });
  const [colab, setColab] = useState<Colab | null>(fixo ?? null);
  const [tipo, setTipo] = useState<Advertencia["tipo"]>("escrita");
  const [dias, setDias] = useState("1");
  const [ocorrencia, setOcorrencia] = useState(hoje());
  const [aplicacao, setAplicacao] = useState(hoje());
  const [motivo, setMotivo] = useState("");
  const [outro, setOutro] = useState("");
  const [descricao, setDescricao] = useState("");
  const [testemunhas, setTestemunhas] = useState("");
  const historico = useQuery({
    queryKey: ["advertencias-colab", colab?.id], enabled: !!colab,
    queryFn: async () => {
      const { data: r, error } = await supabase.rpc("advertencias_listar", { p_loja: null, p_colaborador: colab!.id });
      if (error) throw new Error(error.message);
      return r as Advertencia[];
    },
  });
  const d90 = new Date(Date.now() - 90 * 86400e3).toISOString().slice(0, 10);
  const recentes = (historico.data ?? []).filter((a) => a.data_ocorrencia >= d90);
  const nomeMotivo = motivo === "__outro" ? outro.trim() : motivos.data?.find((m) => m.id === motivo)?.nome ?? "";
  const m = useMutation({
    mutationFn: async () => {
      const { data: id, error } = await supabase.rpc("advertencia_registrar", { p: {
        colaborador_id: colab!.id, tipo, dias_suspensao: tipo === "suspensao" ? Number(dias) : null,
        data_ocorrencia: ocorrencia, data_aplicacao: aplicacao, motivo_id: motivo === "__outro" ? null : motivo, motivo_texto: nomeMotivo,
        descricao, testemunhas: testemunhas || null } });
      if (error) throw error;
      return id as string;
    },
    onSuccess: async (id) => {
      ["advertencias", "advertencias-colab", "painel-pendencias", "timeline"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      avisar("sucesso", "Advertência registrada. Imprima o termo para assinatura.");
      const { data: r } = await supabase.rpc("advertencias_listar", { p_loja: null, p_colaborador: colab!.id });
      const a = (r as Advertencia[] | null)?.find((x) => x.id === id);
      if (a) gerarTermoAdvertencia(a);
      fechar();
    },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  const valido = colab && nomeMotivo && descricao.trim().length >= 10 && (tipo !== "suspensao" || (Number(dias) >= 1 && Number(dias) <= 30));
  return (
    <Modal aberto aoFechar={fechar} largura="max-w-2xl" titulo="Nova advertência" descricao="Registre o fato com clareza: data, o que aconteceu e qual regra foi descumprida.">
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (valido) m.mutate(); }} className="flex flex-col gap-4">
        {fixo ? <p className="rounded-lg bg-fundo px-3 py-2 text-sm"><b>{fixo.nome_completo}</b> · {fixo.loja_nome}</p>
          : <BuscaColaborador valor={colab} lista={colabs.data ?? []} aoEscolher={setColab} />}
        {colab && recentes.length > 0 && (
          <Aviso tom="alerta">
            <span className="inline-flex items-center gap-1 font-medium"><AlertTriangle className="size-4" />{recentes.length} registro(s) nos últimos 90 dias:</span>
            <span className="block">{recentes.map((a) => `${data(a.data_ocorrencia)} · ${rotuloTipo(a)} · ${a.motivo}`).join(" | ")}</span>
          </Aviso>
        )}
        <fieldset className="grid gap-2 sm:grid-cols-3">
          <legend className="mb-1 text-sm font-medium">Tipo</legend>
          {(["verbal", "escrita", "suspensao"] as const).map((t) => (
            <label key={t} className={cx("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", tipo === t ? "border-primaria bg-primaria-suave" : "border-borda")}>
              <input type="radio" name="tipo" checked={tipo === t} onChange={() => setTipo(t)} className="accent-[var(--color-primaria)]" />
              {t === "verbal" ? "Advertência verbal" : t === "escrita" ? "Advertência escrita" : "Suspensão"}
            </label>
          ))}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo rotulo="Data da ocorrência" type="date" obrigatorio value={ocorrencia} max={hoje()} onChange={(e) => setOcorrencia(e.target.value)} />
          <Campo rotulo="Data da aplicação" type="date" obrigatorio value={aplicacao} onChange={(e) => setAplicacao(e.target.value)} />
          {tipo === "suspensao" && <Campo rotulo="Dias de suspensão" type="number" min={1} max={30} obrigatorio value={dias} onChange={(e) => setDias(e.target.value)} dica="Máximo 30 dias (CLT, art. 474)" />}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Selecao rotulo="Motivo" obrigatorio value={motivo} onChange={(e) => setMotivo(e.target.value)}>
            <option value="">Selecione</option>
            {(motivos.data ?? []).filter((x) => x.ativo).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            <option value="__outro">Outro (descrever)</option>
          </Selecao>
          {motivo === "__outro" && <Campo rotulo="Qual motivo?" obrigatorio value={outro} onChange={(e) => setOutro(e.target.value)} />}
        </div>
        <AreaTexto rotulo="Descrição do fato" obrigatorio rows={4} value={descricao} onChange={(e) => setDescricao(e.target.value)}
          placeholder="Ex.: No dia 10/11, chegou às 10h20 sem aviso prévio, com início do turno às 9h. Já havia sido orientada verbalmente em 03/11." />
        <Campo rotulo="Testemunhas (se houver)" value={testemunhas} onChange={(e) => setTestemunhas(e.target.value)} placeholder="Nomes, separados por vírgula"
          dica="Necessárias se o colaborador se recusar a assinar." />
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundaria" onClick={fechar}>Cancelar</Botao>
          <Botao type="submit" carregando={m.isPending} disabled={!valido} icone={<FileSignature className="size-4" />}>Registrar e gerar termo</Botao>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- Anexar termo assinado ---------------- */
function AnexarAssinada({ a, fechar }: { a: Advertencia; fechar: () => void }) {
  const qc = useQueryClient(); const avisar = useAvisos();
  const categorias = useCategorias();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [recusou, setRecusou] = useState(false);
  const cat = categorias.data?.find((k) => k.codigo === "advertencias_ocorrencias");
  const m = useMutation({
    mutationFn: async () => {
      if (!cat) throw new Error("Categoria de advertências não encontrada");
      const fd = new FormData(); fd.append("arquivo", arquivo!);
      fd.append("meta", JSON.stringify({ categoria_id: cat.id, colaborador_id: a.colaborador_id, nome: `${rotuloTipo(a).toUpperCase()} · ${a.motivo.toUpperCase()}`, data_emissao: a.data_aplicacao }));
      const r = await chamarFuncao<{ documento_id: string }>("documentos-upload", fd, false);
      const { error } = await supabase.rpc("advertencia_anexar", { p_id: a.id, p_documento: r.documento_id, p_recusou: recusou });
      if (error) throw error;
    },
    onSuccess: () => { ["advertencias", "advertencias-colab", "documentos", "painel-pendencias"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); avisar("sucesso", "Termo anexado."); fechar(); },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  return (
    <Modal aberto aoFechar={fechar} titulo="Anexar termo assinado" descricao={`${a.colaborador_nome} · ${rotuloTipo(a)} · ${data(a.data_ocorrencia)}`}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (arquivo) m.mutate(); }} className="flex flex-col gap-4">
        <Campo rotulo="Arquivo (PDF ou foto)" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" obrigatorio onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={recusou} onChange={(e) => setRecusou(e.target.checked)} />
          O colaborador se recusou a assinar; o termo foi assinado por testemunhas.
        </label>
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundaria" onClick={fechar}>Cancelar</Botao>
          <Botao type="submit" carregando={m.isPending} disabled={!arquivo}>Anexar</Botao>
        </div>
      </form>
    </Modal>
  );
}

function CancelarAdvertencia({ a, fechar }: { a: Advertencia; fechar: () => void }) {
  const qc = useQueryClient(); const avisar = useAvisos();
  const [motivo, setMotivo] = useState("");
  const m = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc("advertencia_cancelar", { p_id: a.id, p_motivo: motivo }); if (error) throw error; },
    onSuccess: () => { ["advertencias", "advertencias-colab", "painel-pendencias"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); avisar("sucesso", "Registro cancelado."); fechar(); },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  return (
    <Modal aberto aoFechar={fechar} titulo="Cancelar advertência" descricao={`${a.colaborador_nome} · ${rotuloTipo(a)} · ${data(a.data_ocorrencia)}`}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        <Aviso tom="info">O registro não é apagado: fica no histórico como cancelado, com o motivo.</Aviso>
        <AreaTexto rotulo="Motivo do cancelamento" obrigatorio rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundaria" onClick={fechar}>Voltar</Botao>
          <Botao type="submit" variante="perigo" carregando={m.isPending} disabled={motivo.trim().length < 5}>Cancelar registro</Botao>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- Motivos (lista editável) ---------------- */
function GerenciarMotivos({ fechar }: { fechar: () => void }) {
  const qc = useQueryClient(); const avisar = useAvisos();
  const motivos = useMotivosAdvertencia();
  const [novo, setNovo] = useState("");
  const salvar = useMutation({
    mutationFn: async (p: { id: string | null; nome: string; ativo: boolean }) => {
      const { error } = await supabase.rpc("advertencia_motivo_salvar", { p_id: p.id, p_nome: p.nome, p_ativo: p.ativo }); if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["advertencia-motivos"] }); setNovo(""); },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  return (
    <Modal aberto aoFechar={fechar} titulo="Motivos de advertência" descricao="A lista que aparece ao registrar uma advertência.">
      <div className="flex flex-col gap-3">
        <ul className="max-h-80 divide-y divide-borda overflow-y-auto rounded-lg border border-borda">
          {(motivos.data ?? []).map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className={x.ativo ? "" : "text-texto-suave line-through"}>{x.nome}</span>
              <Botao tamanho="sm" variante="fantasma" onClick={() => salvar.mutate({ id: x.id, nome: x.nome, ativo: !x.ativo })}>{x.ativo ? "Desativar" : "Reativar"}</Botao>
            </li>
          ))}
        </ul>
        <form onSubmit={(e) => { e.preventDefault(); if (novo.trim()) salvar.mutate({ id: null, nome: novo.trim(), ativo: true }); }} className="flex items-end gap-2">
          <Campo rotulo="Novo motivo" value={novo} onChange={(e) => setNovo(e.target.value)} className="flex-1" />
          <Botao type="submit" carregando={salvar.isPending} disabled={!novo.trim()}>Adicionar</Botao>
        </form>
      </div>
    </Modal>
  );
}

/* ---------------- Termo de advertência / suspensão ---------------- */
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const porExtenso = (iso: string) => { const [a, m, d] = iso.split("-"); return `${Number(d)} de ${MESES[Number(m) - 1]} de ${a}`; };
const cpfFmt = (v?: string | null) => { const d = (v ?? "").replace(/\D/g, ""); return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : ""; };

export async function gerarTermoAdvertencia(a: Advertencia) {
  await carregarLogo();
  const susp = a.tipo === "suspensao";
  const titulo = susp ? "Termo de Suspensão Disciplinar" : a.tipo === "verbal" ? "Registro de Advertência Verbal" : "Termo de Advertência Disciplinar";
  const up = (s: string | null) => esc((s ?? "").toUpperCase());
  const medida = susp
    ? `aplicar-lhe a pena de <b>SUSPENSÃO DISCIPLINAR por ${a.dias_suspensao} (${a.dias_suspensao === 1 ? "um" : a.dias_suspensao}) dia(s)</b>, sem remuneração, a contar de ${data(a.data_aplicacao)}, devendo retornar ao trabalho no dia útil seguinte ao término da suspensão`
    : `aplicar-lhe a presente <b>ADVERTÊNCIA ${a.tipo === "verbal" ? "VERBAL (registrada por escrito)" : "POR ESCRITO"}</b>`;
  const corpo = `
<h2>1. Dados do Colaborador</h2><table>
<tr><td class="r">Nome completo</td><td class="v" colspan="3">${up(a.colaborador_nome)}</td><td class="r">CPF</td><td class="v" style="white-space:nowrap">${esc(cpfFmt(a.cpf))}</td></tr>
<tr><td class="r">Cargo / Função</td><td class="v">${up(a.cargo_nome)}</td><td class="r">Loja / Unidade</td><td class="v">${up(a.loja_nome)}</td><td class="r">Data da ocorrência</td><td class="v">${data(a.data_ocorrencia)}</td></tr></table>
<h2>2. Motivo</h2><p><b>${up(a.motivo)}</b></p><p style="white-space:pre-wrap">${esc(a.descricao)}</p>
<h2>3. Medida aplicada</h2>
<p>Pelo presente, a Óticas Idealize comunica ao(à) colaborador(a) acima identificado(a) que, em razão do fato descrito, que contraria as normas do Regimento Interno e Código de Conduta e as obrigações do contrato de trabalho, decidiu ${medida}.</p>
<p>Esclarecemos que a repetição desta ou de outra falta poderá resultar na aplicação de medidas disciplinares mais severas, conforme a Gestão de Consequências prevista na seção 11 do Regimento Interno, inclusive a rescisão do contrato de trabalho por justa causa, nos termos do art. 482 da CLT.</p>
<p>A assinatura deste termo indica apenas a ciência do(a) colaborador(a) quanto ao seu conteúdo, e não a concordância com ele.</p>
<h2>4. Assinaturas</h2>
<p style="text-align:right">${esc((a.loja_nome ?? "").replace(/^ÓTICAS IDEALIZE /i, ""))}, ${porExtenso(a.data_aplicacao)}.</p>
<div class="duas"><div><b>Colaborador(a) — ciente</b><br>${up(a.colaborador_nome)}</div><div><b>Gestor / RH</b><br>Óticas Idealize</div></div>
<p style="margin-top:28px;font-size:10.5px">Em caso de recusa do(a) colaborador(a) em assinar, as testemunhas abaixo declaram que o termo foi lido e entregue na sua presença:</p>
<div class="duas"><div>Testemunha 1${a.testemunhas ? `: ${up(a.testemunhas.split(",")[0])}` : ""}<br>CPF:</div><div>Testemunha 2${a.testemunhas?.includes(",") ? `: ${up(a.testemunhas.split(",")[1])}` : ""}<br>CPF:</div></div>`;
  imprimir(pagina(titulo, corpo, "Uso Interno · Confidencial"), `${titulo} - ${a.colaborador_nome}`);
}

export function useAdvertenciasColaborador(colaborador: string) {
  return useQuery({
    queryKey: ["advertencias-colab", colaborador],
    queryFn: async () => {
      const { data: r, error } = await supabase.rpc("advertencias_listar", { p_loja: null, p_colaborador: colaborador });
      if (error) throw new Error(error.message);
      return r as Advertencia[];
    },
  });
}

export function AdvertenciasColaborador({ c }: { c: ColaboradorLinha }) {
  const { permissoes } = useAuth();
  const q = useAdvertenciasColaborador(c.id);
  const [nova, setNova] = useState(false);
  const podeRegistrar = permissoes.some((p) => p.permissao === "documento.disciplinar.enviar" && p.liberada_na_sessao);
  const lista = useMemo(() => q.data ?? [], [q.data]);
  return (
    <Cartao titulo={`Advertências (${lista.length})`} acao={podeRegistrar && <Botao tamanho="sm" icone={<Plus className="size-4" />} onClick={() => setNova(true)}>Nova advertência</Botao>}>
      {q.isLoading ? <Carregando /> : lista.length === 0 ? <EstadoVazio titulo="Nenhuma advertência" descricao="Este colaborador não tem advertências registradas." /> : <ListaAdvertencias lista={lista} />}
      {nova && <NovaAdvertencia fixo={c} fechar={() => setNova(false)} />}
    </Cartao>
  );
}
