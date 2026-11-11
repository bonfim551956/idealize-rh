import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, CalendarClock, Eye, FileSignature, FileText, Gavel, Loader2, Plus, Repeat2, Settings2, Sparkles, Trash2, Upload, type LucideIcon } from "lucide-react";
import { chamarFuncao, mensagemErro, supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import { falhar, useCategorias, useLojas, type ColaboradorLinha } from "../lib/dados";
import { data, hoje } from "../lib/formato";
import { AreaTexto, Aviso, Botao, CabecalhoPagina, Campo, Cartao, Carregando, EstadoErro, EstadoVazio, Modal, Selecao, Selo, Tabela, cx, useAvisos } from "../ui/componentes";
import { BuscaColaborador } from "./EnvioDocumentos";

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
        descricao="Controle das advertências verbais, escritas e suspensões: envie o documento assinado e o sistema registra motivo, data e o que aconteceu. Sigiloso: só quem tem acesso a documentos disciplinares."
        acoes={<div className="flex flex-wrap items-end gap-2">
          {(lojas.data?.length ?? 0) > 1 && (
            <Selecao rotulo="Loja" value={loja} onChange={(e) => setLoja(e.target.value)} className="w-56">
              <option value="">Todas as lojas</option>
              {lojas.data!.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </Selecao>
          )}
          {pode("config.estrutura.gerir") && <Botao variante="secundaria" icone={<Settings2 className="size-4" />} onClick={() => setMotivos(true)}>Motivos</Botao>}
          {podeRegistrar && <Botao icone={<Plus className="size-4" />} onClick={() => setNova(true)}>Registrar advertência</Botao>}
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
  const avisar = useAvisos();
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
                {a.documento_id && <Botao tamanho="sm" variante="fantasma" aria-label="Ver documento" title="Ver documento" icone={<Eye className="size-4" />} onClick={() => abrirDocumento(a.documento_id!, avisar)} />}
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

/* ---------------- Registrar advertência a partir do documento ---------------- */
type Colab = Pick<ColaboradorLinha, "id" | "nome_completo" | "loja_atual_id" | "loja_nome">;
type LeituraAdv = {
  sugestao: { categoria_codigo: string; data_emissao: string | null; confianca: string };
  advertencia: { tipo: Advertencia["tipo"] | null; dias_suspensao: number | null; data_ocorrencia: string | null; motivo: string | null;
    relato: string | null; testemunhas: string | null; assinatura: "colaborador" | "testemunhas" | "sem_assinatura" | null } | null;
  pessoa: { nome: string | null }; colaborador: Colab | null;
};
const ACEITOS = "application/pdf,image/jpeg,image/png,image/webp";

export function NovaAdvertencia({ fixo, fechar }: { fixo?: Colab; fechar: () => void }) {
  const qc = useQueryClient(); const avisar = useAvisos();
  const motivos = useMotivosAdvertencia();
  const categorias = useCategorias();
  const cat = categorias.data?.find((k) => k.codigo === "advertencias_ocorrencias");
  const colabs = useQuery({
    queryKey: ["colaboradores-advertencia"], enabled: !fixo,
    queryFn: async () => falhar(await supabase.from("v_colaboradores").select("id,nome_completo,loja_atual_id,loja_nome")
      .in("status", ["ativo", "em_ferias", "afastado", "em_licenca", "em_desligamento"]).order("nome_completo")) as Colab[],
  });
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [lendo, setLendo] = useState(false);
  const [leitura, setLeitura] = useState<{ ok: boolean; aviso?: string; pessoa?: string | null } | null>(null);
  const [colab, setColab] = useState<Colab | null>(fixo ?? null);
  const [tipo, setTipo] = useState<Advertencia["tipo"]>("escrita");
  const [dias, setDias] = useState("1");
  const [ocorrencia, setOcorrencia] = useState(hoje());
  const [aplicacao, setAplicacao] = useState(hoje());
  const [motivo, setMotivo] = useState("");
  const [outro, setOutro] = useState("");
  const [descricao, setDescricao] = useState("");
  const [testemunhas, setTestemunhas] = useState("");
  const [assinatura, setAssinatura] = useState<"colaborador" | "testemunhas">("colaborador");
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

  const ler = async (f: File) => {
    setArquivo(f); setLendo(true); setLeitura(null);
    try {
      const fd = new FormData(); fd.append("arquivo", f);
      const r = await chamarFuncao<LeituraAdv>("documentos-classificar", fd, false);
      const a = r.advertencia;
      if (!fixo && r.colaborador) setColab(r.colaborador);
      if (r.sugestao.data_emissao) setAplicacao(r.sugestao.data_emissao);
      if (a) {
        if (a.tipo) setTipo(a.tipo);
        if (a.dias_suspensao) setDias(String(a.dias_suspensao));
        if (a.data_ocorrencia) setOcorrencia(a.data_ocorrencia); else if (r.sugestao.data_emissao) setOcorrencia(r.sugestao.data_emissao);
        if (a.motivo) {
          const m = motivos.data?.find((x) => x.ativo && x.nome.toUpperCase() === a.motivo!.toUpperCase());
          if (m) { setMotivo(m.id); setOutro(""); } else { setMotivo("__outro"); setOutro(a.motivo); }
        }
        if (a.relato) setDescricao(a.relato);
        if (a.testemunhas) setTestemunhas(a.testemunhas);
        if (a.assinatura === "testemunhas") setAssinatura("testemunhas");
      }
      setLeitura(a ? { ok: true, pessoa: r.pessoa.nome, aviso: a.assinatura === "sem_assinatura" ? "O documento parece não ter assinatura. Confira se é a via assinada." : undefined }
        : { ok: false, pessoa: r.pessoa.nome, aviso: "Este arquivo não parece ser uma advertência ou suspensão. Confira o arquivo ou preencha os campos manualmente." });
    } catch (e) {
      setLeitura({ ok: false, aviso: `${mensagemErro(e)} Preencha os campos manualmente.` });
    } finally { setLendo(false); }
  };

  const m = useMutation({
    mutationFn: async () => {
      if (!cat) throw new Error("Categoria de advertências não encontrada");
      const { data: id, error } = await supabase.rpc("advertencia_registrar", { p: {
        colaborador_id: colab!.id, tipo, dias_suspensao: tipo === "suspensao" ? Number(dias) : null,
        data_ocorrencia: ocorrencia, data_aplicacao: aplicacao, motivo_id: motivo === "__outro" ? null : motivo, motivo_texto: nomeMotivo,
        descricao, testemunhas: testemunhas || null } });
      if (error) throw error;
      try {
        const fd = new FormData(); fd.append("arquivo", arquivo!);
        fd.append("meta", JSON.stringify({ categoria_id: cat.id, colaborador_id: colab!.id,
          nome: `${(tipo === "suspensao" ? `SUSPENSÃO ${dias} DIA(S)` : tipo === "verbal" ? "ADVERTÊNCIA VERBAL" : "ADVERTÊNCIA ESCRITA")} · ${nomeMotivo.toUpperCase()}`, data_emissao: aplicacao }));
        const r = await chamarFuncao<{ documento_id: string }>("documentos-upload", fd, false);
        const { error: e2 } = await supabase.rpc("advertencia_anexar", { p_id: id, p_documento: r.documento_id, p_recusou: assinatura === "testemunhas" });
        if (e2) throw e2;
      } catch (e) {
        throw new Error(`A advertência foi registrada, mas o arquivo não foi guardado (${mensagemErro(e)}). Use "Anexar" na lista para enviar de novo.`);
      }
    },
    onSettled: () => ["advertencias", "advertencias-colab", "documentos", "painel-pendencias", "timeline"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
    onSuccess: () => { avisar("sucesso", "Advertência registrada e documento guardado."); fechar(); },
    onError: (e) => { avisar("erro", mensagemErro(e)); if (String((e as Error).message).startsWith("A advertência foi registrada")) fechar(); },
  });
  const valido = arquivo && colab && nomeMotivo && descricao.trim().length >= 10 && (tipo !== "suspensao" || (Number(dias) >= 1 && Number(dias) <= 30));

  return (
    <Modal aberto aoFechar={fechar} largura="max-w-2xl" titulo="Registrar advertência"
      descricao="Envie a advertência ou suspensão já assinada. O sistema lê o documento, preenche o registro e guarda o arquivo para controle.">
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (valido) m.mutate(); }} className="flex flex-col gap-4">
        <label className={cx("flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm",
          arquivo ? "border-primaria bg-primaria-suave" : "border-borda hover:bg-fundo")}>
          <input type="file" accept={ACEITOS} className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) ler(f); e.target.value = ""; }} />
          {lendo ? <><Loader2 className="size-6 animate-spin text-primaria" /><span>Lendo o documento…</span></>
            : arquivo ? <><FileText className="size-6 text-primaria" /><span className="font-medium">{arquivo.name}</span><span className="text-xs text-texto-suave">Clique para trocar o arquivo</span></>
            : <><Upload className="size-6 text-texto-suave" /><span className="font-medium">Escolher arquivo da advertência</span><span className="text-xs text-texto-suave">PDF ou foto do documento assinado</span></>}
        </label>
        {leitura?.ok && <Aviso tom="sucesso"><span className="inline-flex items-center gap-1"><Sparkles className="size-4" />Campos preenchidos a partir do documento. Confira antes de salvar.</span></Aviso>}
        {leitura?.aviso && <Aviso tom="alerta">{leitura.aviso}</Aviso>}
        {leitura && !colab && !fixo && <Aviso tom="alerta">{leitura.pessoa ? `Não encontrei "${leitura.pessoa}" no cadastro. ` : ""}Escolha o colaborador abaixo.</Aviso>}

        {arquivo && !lendo && (<>
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
          <AreaTexto rotulo="O que aconteceu" obrigatorio rows={4} value={descricao} onChange={(e) => setDescricao(e.target.value)}
            dica="Resumo do fato segundo o documento. Ajuste se precisar." />
          <div className="grid gap-3 sm:grid-cols-2">
            <Selecao rotulo="Assinatura" value={assinatura} onChange={(e) => setAssinatura(e.target.value as typeof assinatura)}>
              <option value="colaborador">Assinada pelo colaborador</option>
              <option value="testemunhas">Recusou assinar (assinada por testemunhas)</option>
            </Selecao>
            <Campo rotulo="Testemunhas (se houver)" value={testemunhas} onChange={(e) => setTestemunhas(e.target.value)} placeholder="Nomes, separados por vírgula" />
          </div>
        </>)}
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundaria" onClick={fechar}>Cancelar</Botao>
          <Botao type="submit" carregando={m.isPending} disabled={!valido || lendo} icone={<FileSignature className="size-4" />}>Registrar e guardar</Botao>
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
async function abrirDocumento(documentoId: string, avisar: ReturnType<typeof useAvisos>) {
  const janela = window.open("", "_blank");
  try {
    const r = await chamarFuncao<{ url: string }>("documentos-acesso", JSON.stringify({ documento_id: documentoId, acao: "visualizar" }));
    if (janela) { janela.opener = null; janela.location.href = r.url; } else window.location.href = r.url;
  } catch (e) { janela?.close(); avisar("erro", mensagemErro(e)); }
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
    <Cartao titulo={`Advertências (${lista.length})`} acao={podeRegistrar && <Botao tamanho="sm" icone={<Plus className="size-4" />} onClick={() => setNova(true)}>Registrar advertência</Botao>}>
      {q.isLoading ? <Carregando /> : lista.length === 0 ? <EstadoVazio titulo="Nenhuma advertência" descricao="Este colaborador não tem advertências registradas." /> : <ListaAdvertencias lista={lista} />}
      {nova && <NovaAdvertencia fixo={c} fechar={() => setNova(false)} />}
    </Cartao>
  );
}
