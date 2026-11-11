import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Sparkles, Trash2, XCircle } from "lucide-react";
import { chamarFuncao, mensagemErro, supabase } from "../lib/supabase";
import { falhar, useCategorias, type ColaboradorLinha, type DocumentoLinha } from "../lib/dados";
import { useAuth } from "../auth/AuthProvider";
import { data as dataBR } from "../lib/formato";
import { AreaTexto, Aviso, Botao, Campo, Modal, Selecao, Selo, cx, useAvisos } from "../ui/componentes";

const TIPOS_ACEITOS = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const LIMITE = 20 * 1024 * 1024;
const MAX_ARQUIVOS = 30;
const LEITURAS_SIMULTANEAS = 3;

type Colab = Pick<ColaboradorLinha, "id" | "nome_completo" | "loja_atual_id" | "loja_nome">;
type Meta = { categoria_id: string; nome: string; data_emissao: string; competencia: string; vencimento: string; colaborador: Colab | null;
  horario_inicio?: string; horario_fim?: string; cid?: string;
  afast_inicio?: string; afast_dias?: string; lancar_ausencia?: boolean };
const COM_HORARIO_CID = ["atestados_medicos", "declaracao_comparecimento"];
const somaDiasISO = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
type Estado = "lendo" | "pronto" | "manual" | "enviando" | "enviado" | "falhou";
type Item = {
  id: string; arquivo: File; estado: Estado; meta: Meta;
  ia?: { confianca: string; justificativa: string | null; pessoa_nome: string | null; cpf_mascarado: string | null; divergente: boolean; multiplos: boolean };
  erro?: string;
};
type RespostaIA = {
  sugestao: { categoria_id: string; nome: string; data_emissao: string | null; competencia: string | null; vencimento: string | null; confianca: string; justificativa: string | null;
    horario_inicio?: string | null; horario_fim?: string | null; cid?: string | null; dias_afastamento?: number | null; afastamento_inicio?: string | null };
  pessoa: { nome: string | null; cpf_mascarado: string | null };
  colaborador: Colab | null;
  multiplos: boolean;
};

/** Entrada única: nova versão de um documento existente OU envio inteligente de documentos novos. */
export function EnvioDocumento({ aberto, documento, colaborador, aoFechar, aoConcluir }: {
  aberto: boolean; documento?: DocumentoLinha; colaborador?: ColaboradorLinha; aoFechar: () => void; aoConcluir: () => void;
}) {
  if (!aberto) return null;
  return documento
    ? <NovaVersao documento={documento} aoFechar={aoFechar} aoConcluir={aoConcluir} />
    : <EnvioInteligente colaborador={colaborador} aoFechar={aoFechar} aoConcluir={aoConcluir} />;
}

/* =====================================================================
   Nova versão
   ===================================================================== */
function NovaVersao({ documento, aoFechar, aoConcluir }: { documento: DocumentoLinha; aoFechar: () => void; aoConcluir: () => void }) {
  const avisar = useAvisos();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!arquivo) return setErro("Escolha o arquivo.");
    if (!motivo.trim()) return setErro("Informe o motivo da substituição.");
    setEnviando(true); setErro(null);
    try {
      const fd = new FormData();
      fd.append("arquivo", arquivo); fd.append("documento_id", documento.id); fd.append("motivo", motivo.toUpperCase());
      await chamarFuncao("documentos-upload", fd, false);
      avisar("sucesso", "Nova versão enviada. Ela precisa ser conferida.");
      aoConcluir();
    } catch (e2) { setErro(mensagemErro(e2)); }
    setEnviando(false);
  }

  return (
    <Modal aberto aoFechar={aoFechar} titulo="Enviar nova versão" descricao={documento.nome}>
      <form onSubmit={enviar} className="flex flex-col gap-4">
        <AreaTexto rotulo="Motivo da substituição" value={motivo} onChange={(e) => setMotivo(e.target.value)} obrigatorio />
        <Campo rotulo="Arquivo" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" obrigatorio dica="PDF, JPG, PNG ou WEBP · até 20 MB"
          onChange={(e) => {
            const a = e.target.files?.[0] ?? null;
            if (a && (!TIPOS_ACEITOS.includes(a.type) || a.size > LIMITE)) { setErro("Use PDF, JPG, PNG ou WEBP de até 20 MB."); return; }
            setErro(null); setArquivo(a);
          }} />
        {erro && <Aviso tom="perigo">{erro}</Aviso>}
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundaria" onClick={aoFechar}>Cancelar</Botao>
          <Botao type="submit" carregando={enviando}>Enviar</Botao>
        </div>
      </form>
    </Modal>
  );
}

/* =====================================================================
   Envio inteligente (leitura automática com IA)
   ===================================================================== */
function EnvioInteligente({ colaborador, aoFechar, aoConcluir }: { colaborador?: ColaboradorLinha; aoFechar: () => void; aoConcluir: () => void }) {
  const avisar = useAvisos();
  const categorias = useCategorias();
  const [itens, setItens] = useState<Item[]>([]);
  const [usarIA, setUsarIA] = useState(true);
  const [iaIndisponivel, setIaIndisponivel] = useState<string | null>(null);
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const fila = useRef<string[]>([]);
  const ativos = useRef(0);
  const fixo: Colab | null = colaborador
    ? { id: colaborador.id, nome_completo: colaborador.nome_completo, loja_atual_id: colaborador.loja_atual_id, loja_nome: colaborador.loja_nome }
    : null;

  const colaboradores = useQuery({
    queryKey: ["colaboradores-envio"],
    enabled: !fixo,
    queryFn: async () => falhar(await supabase.from("v_colaboradores").select("id,nome_completo,loja_atual_id,loja_nome")
      .not("status", "in", "(arquivado)").order("nome_completo").limit(2000)) as Colab[],
  });

  const atualizar = (id: string, f: (i: Item) => Item) => setItens((l) => l.map((i) => (i.id === id ? f(i) : i)));

  /* ---------- leitura com IA (fila com no máx. 3 simultâneas) ---------- */
  const lerProximo = useRef<() => void>(() => {});
  lerProximo.current = () => {
    while (ativos.current < LEITURAS_SIMULTANEAS && fila.current.length) {
      const id = fila.current.shift()!;
      const item = itensRef.current.find((i) => i.id === id);
      if (!item) continue;
      ativos.current++;
      const fd = new FormData();
      fd.append("arquivo", item.arquivo);
      chamarFuncao<RespostaIA>("documentos-classificar", fd, false)
        .then((r) => {
          atualizar(id, (i) => {
            const divergente = !!(fixo && r.colaborador && r.colaborador.id !== fixo.id);
            return {
              ...i, estado: "pronto",
              meta: {
                categoria_id: r.sugestao.categoria_id,
                nome: r.sugestao.nome ?? "",
                data_emissao: r.sugestao.data_emissao ?? "",
                competencia: r.sugestao.competencia ?? "",
                vencimento: r.sugestao.vencimento ?? "",
                horario_inicio: r.sugestao.horario_inicio ?? "",
                horario_fim: r.sugestao.horario_fim ?? "",
                cid: r.sugestao.cid ?? "",
                afast_inicio: r.sugestao.afastamento_inicio ?? r.sugestao.data_emissao ?? "",
                afast_dias: r.sugestao.dias_afastamento ? String(r.sugestao.dias_afastamento) : "",
                lancar_ausencia: true,
                colaborador: fixo ?? r.colaborador ?? i.meta.colaborador,
              },
              ia: {
                confianca: r.sugestao.confianca, justificativa: r.sugestao.justificativa,
                pessoa_nome: r.pessoa.nome, cpf_mascarado: r.pessoa.cpf_mascarado, divergente, multiplos: r.multiplos,
              },
            };
          });
        })
        .catch((e) => {
          const msg = mensagemErro(e);
          if (/não configurada|chave da API/i.test(msg)) setIaIndisponivel(msg);
          atualizar(id, (i) => ({ ...i, estado: "manual", erro: `Leitura automática: ${msg}` }));
        })
        .finally(() => { ativos.current--; lerProximo.current(); });
    }
  };
  const itensRef = useRef<Item[]>([]);
  useEffect(() => { itensRef.current = itens; }, [itens]);

  function adicionar(lista: FileList | File[] | null) {
    setErroGeral(null);
    const novos: Item[] = [];
    for (const a of Array.from(lista ?? [])) {
      if (itens.length + novos.length >= MAX_ARQUIVOS) { setErroGeral(`Máximo de ${MAX_ARQUIVOS} arquivos por vez.`); break; }
      if (!TIPOS_ACEITOS.includes(a.type) || a.size === 0 || a.size > LIMITE) { setErroGeral(`"${a.name}": use PDF, JPG, PNG ou WEBP de até 20 MB.`); continue; }
      novos.push({
        id: crypto.randomUUID(), arquivo: a,
        estado: usarIA && !iaIndisponivel ? "lendo" : "manual",
        meta: { categoria_id: "", nome: "", data_emissao: "", competencia: "", vencimento: "", colaborador: fixo },
      });
    }
    if (!novos.length) return;
    setItens((l) => [...l, ...novos]);
    itensRef.current = [...itensRef.current, ...novos];
    if (usarIA && !iaIndisponivel) {
      fila.current.push(...novos.map((n) => n.id));
      lerProximo.current();
    }
  }

  /* ---------- validação e envio ---------- */
  const { pode } = useAuth();
  const qc = useQueryClient();
  const catDe = (id: string) => categorias.data?.find((c) => c.id === id);
  const podeAusencia = (i: Item) => !!i.meta.colaborador && pode("ausencia.registrar", i.meta.colaborador.loja_atual_id);
  function problema(i: Item): string | null {
    const c = catDe(i.meta.categoria_id);
    if (!i.meta.colaborador) return "Escolha o colaborador";
    if (!c) return "Escolha a categoria";
    if (!pode(`documento.${c.nivel_sigilo}.enviar`, i.meta.colaborador.loja_atual_id)) return "Você não pode enviar esta categoria para a loja deste colaborador";
    if (c.exige_competencia && !i.meta.competencia) return "Informe a competência (mês)";
    if (c.exige_vencimento && !i.meta.vencimento) return "Informe o vencimento";
    if (COM_HORARIO_CID.includes(c.codigo)) {
      if (i.meta.horario_inicio && i.meta.horario_fim && i.meta.horario_fim <= i.meta.horario_inicio) return "O horário final deve ser depois do inicial";
      if (i.meta.cid && !/^[A-Z]\d{2}(\.?\d{1,2})?$/.test(i.meta.cid.trim().toUpperCase())) return "CID inválido (ex.: Z00.0)";
      if (i.meta.lancar_ausencia !== false && podeAusencia(i)) {
        if (c.codigo === "atestados_medicos" && (!(i.meta.afast_inicio || i.meta.data_emissao) || !(Number(i.meta.afast_dias) >= 1)))
          return "Informe o início e os dias de afastamento do atestado (ou desmarque “lançar ausência”)";
        if (c.codigo === "declaracao_comparecimento" && !i.meta.data_emissao) return "Informe a data da declaração (emissão)";
      }
    }
    return null;
  }
  const pendentes = itens.filter((i) => i.estado !== "enviado");
  const lendo = itens.some((i) => i.estado === "lendo");
  const comProblema = pendentes.filter((i) => problema(i));

  async function enviarTodos() {
    setEnviando(true);
    let ok = 0, ausencias = 0;
    for (const i of pendentes) {
      if (problema(i)) continue;
      atualizar(i.id, (x) => ({ ...x, estado: "enviando", erro: undefined }));
      try {
        const fd = new FormData();
        fd.append("arquivo", i.arquivo);
        fd.append("meta", JSON.stringify({
          categoria_id: i.meta.categoria_id, colaborador_id: i.meta.colaborador!.id,
          nome: (i.meta.nome || i.arquivo.name).toUpperCase(),
          data_emissao: i.meta.data_emissao || null, competencia: i.meta.competencia || null, vencimento: i.meta.vencimento || null,
          ...(COM_HORARIO_CID.includes(catDe(i.meta.categoria_id)?.codigo ?? "") ? {
            horario_inicio: i.meta.horario_inicio || null, horario_fim: i.meta.horario_fim || null,
            cid: i.meta.cid?.trim().toUpperCase() || null,
          } : {}),
        }));
        const env = await chamarFuncao<{ documento_id: string }>("documentos-upload", fd, false);
        const cod = catDe(i.meta.categoria_id)?.codigo;
        let aviso: string | undefined;
        if (env?.documento_id && i.meta.lancar_ausencia !== false && (cod === "atestados_medicos" || cod === "declaracao_comparecimento")) {
          if (!podeAusencia(i)) aviso = "Ausência não lançada: seu perfil não registra ausências (o DP lança em VT e ausências).";
          else {
            const ini = cod === "atestados_medicos" ? (i.meta.afast_inicio || i.meta.data_emissao) : i.meta.data_emissao;
            const fim = cod === "atestados_medicos" ? somaDiasISO(ini!, Number(i.meta.afast_dias) - 1) : ini;
            const horario = i.meta.horario_inicio && i.meta.horario_fim ? `${i.meta.horario_inicio} ÀS ${i.meta.horario_fim}` : null;
            const { error } = await supabase.rpc("ausencia_registrar", { p: {
              colaborador_id: i.meta.colaborador!.id, tipo: cod === "atestados_medicos" ? "atestado" : "declaracao_horas",
              data_inicio: ini, data_fim: fim, horario: cod === "declaracao_comparecimento" ? horario : null,
              documento_id: env.documento_id, observacao: "LANÇADO AO ENVIAR O DOCUMENTO" } });
            aviso = error ? `Documento enviado, mas a ausência não foi lançada: ${mensagemErro(error)}` : undefined;
            if (!error) ausencias++;
          }
        }
        atualizar(i.id, (x) => ({ ...x, estado: "enviado", erro: aviso }));
        ok++;
      } catch (e) {
        atualizar(i.id, (x) => ({ ...x, estado: "falhou", erro: mensagemErro(e) }));
      }
    }
    setEnviando(false);
    if (ok) avisar("sucesso", (ok === 1 ? "1 documento enviado. Agora ele precisa ser conferido." : `${ok} documentos enviados. Agora eles precisam ser conferidos.`)
      + (ausencias ? ` ${ausencias === 1 ? "1 ausência lançada" : `${ausencias} ausências lançadas`} em VT e ausências.` : ""));
    if (ausencias) { qc.invalidateQueries({ queryKey: ["vt"] }); qc.invalidateQueries({ queryKey: ["ausencias"] }); }
    if (ok && ok === pendentes.length) aoConcluir();
  }

  return (
    <Modal aberto aoFechar={aoFechar} largura="max-w-4xl" titulo="Enviar documentos"
      descricao={fixo ? `Para ${fixo.nome_completo}. Os documentos entram como “Recebido” e só valem depois de conferidos.`
        : "Os documentos entram como “Recebido” e só valem depois de conferidos."}>
      <div className="flex flex-col gap-4">
        {/* leitura automática */}
        <label className="flex items-start gap-3 rounded-lg border border-borda bg-primaria-suave/50 px-4 py-3 text-sm">
          <input type="checkbox" className="mt-1" checked={usarIA && !iaIndisponivel} disabled={!!iaIndisponivel || itens.length > 0}
            onChange={(e) => setUsarIA(e.target.checked)} />
          <span>
            <span className="flex items-center gap-1 font-medium"><Sparkles className="size-4 text-primaria" aria-hidden /> Leitura automática com IA</span>
            <span className="text-texto-suave">O sistema lê cada arquivo e sugere categoria, nome, datas e colaborador. <b>Confira antes de enviar</b> — a sugestão pode errar.</span>
          </span>
        </label>
        {iaIndisponivel && <Aviso tom="alerta">Leitura automática indisponível agora ({iaIndisponivel}). Preencha manualmente.</Aviso>}

        {/* área de arquivos */}
        <label
          onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastando(false); adicionar(e.dataTransfer.files); }}
          className={cx("flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors",
            arrastando ? "border-primaria bg-primaria-suave" : "border-borda hover:border-primaria")}>
          <FileUp className="size-8 text-primaria" aria-hidden />
          <span className="text-sm font-medium">Arraste os arquivos aqui ou clique para escolher</span>
          <span className="text-xs text-texto-suave">PDF, JPG, PNG ou WEBP · até 20 MB cada · até {MAX_ARQUIVOS} por vez</span>
          <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" className="sr-only"
            onChange={(e) => { adicionar(e.target.files); e.target.value = ""; }} />
        </label>
        {erroGeral && <Aviso tom="perigo">{erroGeral}</Aviso>}

        {/* cartões */}
        <ul className="flex flex-col gap-3">
          {itens.map((i) => (
            <CartaoItem key={i.id} item={i} fixo={!!fixo} colaboradores={colaboradores.data ?? []} problema={problema(i)}
              aoMudar={(m) => atualizar(i.id, (x) => ({ ...x, meta: { ...x.meta, ...m } }))}
              aoRemover={() => { fila.current = fila.current.filter((f) => f !== i.id); setItens((l) => l.filter((x) => x.id !== i.id)); }} />
          ))}
        </ul>

        <div className="flex flex-col-reverse gap-2 border-t border-borda pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-texto-suave">
            {lendo ? "Lendo documentos…" : pendentes.length === 0 && itens.length ? "Tudo enviado." :
              comProblema.length ? `${comProblema.length} documento(s) precisam de ajuste antes de enviar.` : itens.length ? "Pronto para enviar." : ""}
          </p>
          <div className="flex justify-end gap-2">
            <Botao type="button" variante="secundaria" onClick={aoFechar}>{itens.some((i) => i.estado === "enviado") ? "Fechar" : "Cancelar"}</Botao>
            <Botao onClick={enviarTodos} carregando={enviando}
              disabled={lendo || enviando || pendentes.length === 0 || pendentes.length === comProblema.length}>
              Enviar {pendentes.length - comProblema.length > 0 ? pendentes.length - comProblema.length : ""} documento(s)
            </Botao>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- Cartão de um arquivo ---------------- */
function CartaoItem({ item: i, fixo, colaboradores, problema, aoMudar, aoRemover }: {
  item: Item; fixo: boolean; colaboradores: Colab[]; problema: string | null;
  aoMudar: (m: Partial<Meta>) => void; aoRemover: () => void;
}) {
  const { pode } = useAuth();
  const categorias = useCategorias();
  const cat = categorias.data?.find((c) => c.id === i.meta.categoria_id);
  const loja = i.meta.colaborador?.loja_atual_id;
  const permitidas = (categorias.data ?? []).filter((c) => !loja || pode(`documento.${c.nivel_sigilo}.enviar`, loja));
  const bloqueado = ["lendo", "enviando", "enviado"].includes(i.estado);
  const tomConf = i.ia?.confianca === "alta" ? "sucesso" : i.ia?.confianca === "media" ? "alerta" : "perigo";

  return (
    <li className={cx("rounded-xl border p-4", i.estado === "enviado" ? "border-sucesso/30 bg-sucesso-suave/40" : i.estado === "falhou" ? "border-perigo/30" : "border-borda")}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={i.arquivo.name}>{i.arquivo.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {i.estado === "lendo" && <span className="inline-flex items-center gap-1 text-xs text-texto-suave"><Loader2 className="size-3 animate-spin" /> Lendo o documento…</span>}
            {i.estado === "enviando" && <span className="inline-flex items-center gap-1 text-xs text-texto-suave"><Loader2 className="size-3 animate-spin" /> Enviando…</span>}
            {i.estado === "enviado" && <span className="inline-flex items-center gap-1 text-xs text-sucesso"><CheckCircle2 className="size-3" /> Enviado</span>}
            {i.estado === "enviado" && i.erro && <span className="inline-flex items-center gap-1 text-xs text-alerta"><AlertTriangle className="size-3" /> {i.erro}</span>}
            {i.ia && i.estado !== "enviado" && <Selo tom={tomConf}><Sparkles className="mr-1 size-3" /> Sugestão IA · confiança {i.ia.confianca === "media" ? "média" : i.ia.confianca}</Selo>}
            {i.estado === "manual" && !i.ia && <Selo>Preenchimento manual</Selo>}
          </div>
        </div>
        {!["enviando", "enviado"].includes(i.estado) &&
          <button onClick={aoRemover} className="rounded-lg p-1.5 text-texto-suave hover:bg-perigo-suave hover:text-perigo" aria-label={`Remover ${i.arquivo.name}`}><Trash2 className="size-4" /></button>}
      </div>

      {i.estado !== "enviado" && (
        <>
          {i.ia?.divergente && (
            <div className="mb-3"><Aviso tom="perigo"><AlertTriangle className="mr-1 inline size-4" />
              Este documento parece ser de <b>{i.ia.pessoa_nome ?? "outra pessoa"}</b>{i.ia.cpf_mascarado && ` (CPF ${i.ia.cpf_mascarado})`}, não do colaborador desta ficha. Confira antes de enviar.
            </Aviso></div>
          )}
          {i.ia && !i.meta.colaborador && (i.ia.pessoa_nome || i.ia.cpf_mascarado) && (
            <div className="mb-3"><Aviso tom="alerta">
              {i.ia.multiplos ? "Há mais de um colaborador com este nome." : "Não encontrei este colaborador entre os que você acessa."} No documento: <b>{i.ia.pessoa_nome ?? "—"}</b>{i.ia.cpf_mascarado && ` · CPF ${i.ia.cpf_mascarado}`}. Escolha abaixo.
            </Aviso></div>
          )}
          <div className={cx("grid gap-3 sm:grid-cols-2", bloqueado && "pointer-events-none opacity-60")}>
            {!fixo && <BuscaColaborador valor={i.meta.colaborador} lista={colaboradores} aoEscolher={(c) => aoMudar({ colaborador: c })} />}
            <Selecao rotulo="Categoria" value={i.meta.categoria_id} onChange={(e) => aoMudar({ categoria_id: e.target.value })} obrigatorio>
              <option value="">Selecione</option>
              {permitidas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              {cat && !permitidas.includes(cat) && <option value={cat.id}>{cat.nome} (sem permissão)</option>}
            </Selecao>
            <Campo rotulo="Nome do documento" value={i.meta.nome} onChange={(e) => aoMudar({ nome: e.target.value })} placeholder="Em branco: nome do arquivo" />
            <div className="grid grid-cols-3 gap-3 sm:col-span-2">
              <Campo rotulo="Emissão" type="date" value={i.meta.data_emissao} onChange={(e) => aoMudar({ data_emissao: e.target.value })} />
              <Campo rotulo="Competência" type="month" value={i.meta.competencia.slice(0, 7)} obrigatorio={cat?.exige_competencia}
                onChange={(e) => aoMudar({ competencia: e.target.value ? `${e.target.value}-01` : "" })} />
              <Campo rotulo="Vencimento" type="date" value={i.meta.vencimento} obrigatorio={cat?.exige_vencimento}
                onChange={(e) => aoMudar({ vencimento: e.target.value })} />
            </div>
            {cat && COM_HORARIO_CID.includes(cat.codigo) && (
              <div className="grid grid-cols-3 gap-3 rounded-lg bg-fundo p-3 sm:col-span-2">
                <Campo rotulo="Horário — de" type="time" value={i.meta.horario_inicio ?? ""} onChange={(e) => aoMudar({ horario_inicio: e.target.value })} />
                <Campo rotulo="Horário — até" type="time" value={i.meta.horario_fim ?? ""} onChange={(e) => aoMudar({ horario_fim: e.target.value })} />
                <Campo rotulo="CID" value={i.meta.cid ?? ""} onChange={(e) => aoMudar({ cid: e.target.value })} placeholder="Ex.: Z00.0" maxLength={10}
                  dica="Sigiloso: só DP e diretoria veem" />
                {cat.codigo === "atestados_medicos" && (
                  <>
                    <Campo rotulo="Afastamento a partir de" type="date" value={i.meta.afast_inicio || i.meta.data_emissao} onChange={(e) => aoMudar({ afast_inicio: e.target.value })} />
                    <Campo rotulo="Dias de afastamento" type="number" min={1} max={365} value={i.meta.afast_dias ?? ""} onChange={(e) => aoMudar({ afast_dias: e.target.value })} />
                    <p className="self-end pb-2 text-xs text-texto-suave">
                      {Number(i.meta.afast_dias) >= 1 && (i.meta.afast_inicio || i.meta.data_emissao) ? `Até ${dataBR(somaDiasISO(i.meta.afast_inicio || i.meta.data_emissao, Number(i.meta.afast_dias) - 1))}` : ""}
                    </p>
                  </>
                )}
                <label className="col-span-3 flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={i.meta.lancar_ausencia !== false} onChange={(e) => aoMudar({ lancar_ausencia: e.target.checked })} />
                  <span>{cat.codigo === "atestados_medicos"
                    ? <>Lançar a ausência (atestado) em <b>VT e ausências</b> — os dias são descontados do VT do mês seguinte.</>
                    : <>Lançar a declaração de horas em <b>VT e ausências</b> (na data de emissão, com o horário). Não desconta do VT.</>}</span>
                </label>
              </div>
            )}
          </div>
          {i.ia?.justificativa && <p className="mt-2 text-xs text-texto-suave"><Sparkles className="mr-1 inline size-3" />{i.ia.justificativa}</p>}
          {(problema || i.erro) && i.estado !== "lendo" && (
            <p className="mt-2 flex items-center gap-1 text-xs text-perigo"><XCircle className="size-3" /> {i.erro && i.estado === "falhou" ? i.erro : problema ?? i.erro}</p>
          )}
        </>
      )}
    </li>
  );
}

/* ---------------- Busca de colaborador ---------------- */
export function BuscaColaborador({ valor, lista, aoEscolher }: { valor: Colab | null; lista: Colab[]; aoEscolher: (c: Colab | null) => void }) {
  const [texto, setTexto] = useState("");
  const [aberto, setAberto] = useState(false);
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const resultados = useMemo(() => lista.filter((c) => norm(c.nome_completo).includes(norm(texto))).slice(0, 30), [lista, texto]);

  if (valor) {
    return (
      <div>
        <p className="mb-1 text-sm font-medium">Colaborador <span className="text-perigo" aria-hidden>*</span></p>
        <div className="flex h-10 items-center justify-between rounded-lg border border-borda bg-superficie px-3 text-sm">
          <span className="truncate">{valor.nome_completo} <span className="text-texto-suave">· {valor.loja_nome}</span></span>
          <button type="button" className="text-xs text-primaria hover:underline" onClick={() => { aoEscolher(null); setTexto(""); setAberto(true); }}>Trocar</button>
        </div>
      </div>
    );
  }
  return (
    <div className="relative">
      <Campo rotulo="Colaborador" placeholder="Digite para buscar" value={texto} obrigatorio
        onChange={(e) => { setTexto(e.target.value); setAberto(true); }} onFocus={() => setAberto(true)} />
      {aberto && texto && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-borda bg-superficie shadow-lg">
          {resultados.map((c) => (
            <li key={c.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-fundo"
              onClick={() => { aoEscolher(c); setAberto(false); }}>{c.nome_completo} <span className="text-texto-suave">· {c.loja_nome}</span></button></li>
          ))}
          {resultados.length === 0 && <li className="px-3 py-2 text-sm text-texto-suave">Ninguém encontrado</li>}
        </ul>
      )}
    </div>
  );
}
