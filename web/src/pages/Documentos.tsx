import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CheckCircle2, Download, Eye, FilePlus2, RefreshCw, XCircle } from "lucide-react";
import { chamarFuncao, mensagemErro, supabase } from "../lib/supabase";
import { falhar, useCategorias, useLojas, type ColaboradorLinha, type DocumentoLinha } from "../lib/dados";
import { SIGILO, STATUS_DOCUMENTO, data, hoje } from "../lib/formato";
import { useAuth } from "../auth/AuthProvider";
import { AreaTexto, Aviso, Botao, CabecalhoPagina, Campo, Cartao, Carregando, EstadoErro, EstadoVazio, Modal, Selecao, Selo, Tabela, useAvisos } from "../ui/componentes";

const TIPOS_ACEITOS = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const LIMITE = 20 * 1024 * 1024;

export function PaginaDocumentos() {
  return (
    <>
      <CabecalhoPagina titulo="Documentos" descricao="Arquivos em armazenamento privado. Cada visualização e download fica registrado." />
      <ListaDocumentos />
    </>
  );
}

/** Lista de documentos com filtros. Se `colaborador` vier, mostra só os dele (usado na ficha). */
export function ListaDocumentos({ colaborador }: { colaborador?: ColaboradorLinha }) {
  const { pode, permissoes } = useAuth();
  const lojas = useLojas();
  const categorias = useCategorias();
  const qc = useQueryClient();
  const avisar = useAvisos();
  const [filtro, setFiltro] = useState({ loja: "", categoria: "", status: "" });
  const [envio, setEnvio] = useState<{ aberto: boolean; documento?: DocumentoLinha }>({ aberto: false });
  const [conferindo, setConferindo] = useState<DocumentoLinha | null>(null);
  const [arquivando, setArquivando] = useState<DocumentoLinha | null>(null);

  const q = useQuery({
    queryKey: ["documentos", colaborador?.id ?? null, filtro],
    queryFn: async () => {
      let r = supabase.from("v_documentos").select("*").order("criado_em", { ascending: false }).limit(500);
      if (colaborador) r = r.eq("colaborador_id", colaborador.id);
      if (filtro.loja) r = r.eq("loja_id", filtro.loja);
      if (filtro.categoria) r = r.eq("categoria_id", filtro.categoria);
      if (filtro.status) r = r.eq("status", filtro.status);
      return falhar(await r) as DocumentoLinha[];
    },
  });

  const podeEnviarAlgo = permissoes.some((p) => /^documento\.[a-z]+\.enviar$/.test(p.permissao) && p.liberada_na_sessao);

  async function abrir(d: DocumentoLinha, acao: "visualizar" | "download") {
    const janela = acao === "visualizar" ? window.open("", "_blank") : null; // abre antes para não ser bloqueada
    try {
      const r = await chamarFuncao<{ url: string }>("documentos-acesso", JSON.stringify({ documento_id: d.id, acao }));
      if (janela) { janela.opener = null; janela.location.href = r.url; }
      else window.location.href = r.url;
    } catch (e) {
      janela?.close();
      avisar("erro", mensagemErro(e));
    }
  }

  const recarregar = () => { qc.invalidateQueries({ queryKey: ["documentos"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); };

  return (
    <Cartao titulo={colaborador ? "Documentos" : undefined}
      acao={podeEnviarAlgo && (colaborador || !colaborador) &&
        <Botao tamanho="sm" icone={<FilePlus2 className="size-4" />} onClick={() => setEnvio({ aberto: true })}>Enviar documento</Botao>}>
      {!colaborador && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Selecao rotulo="Loja" value={filtro.loja} onChange={(e) => setFiltro((f) => ({ ...f, loja: e.target.value }))}>
            <option value="">Todas</option>
            {lojas.data?.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </Selecao>
          <Selecao rotulo="Categoria" value={filtro.categoria} onChange={(e) => setFiltro((f) => ({ ...f, categoria: e.target.value }))}>
            <option value="">Todas</option>
            {categorias.data?.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </Selecao>
          <Selecao rotulo="Status" value={filtro.status} onChange={(e) => setFiltro((f) => ({ ...f, status: e.target.value }))}>
            <option value="">Todos</option>
            {Object.entries(STATUS_DOCUMENTO).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}
          </Selecao>
        </div>
      )}

      {q.isLoading && <Carregando />}
      {q.error && <EstadoErro mensagem={(q.error as Error).message} tentarNovamente={() => q.refetch()} />}
      {q.data?.length === 0 && <EstadoVazio titulo="Nenhum documento" descricao="Você só vê as categorias permitidas para o seu perfil." />}
      {!!q.data?.length && (
        <Tabela cabecalho={colaborador ? ["Documento", "Categoria", "Vencimento", "Status", ""] : ["Documento", "Colaborador", "Categoria", "Vencimento", "Status", ""]}>
          {q.data.map((d) => {
            const vencido = d.vencimento && d.vencimento < hoje() && d.status !== "arquivado";
            return (
              <tr key={d.id} className="hover:bg-fundo">
                <td className="px-4 py-3">
                  <p className="font-medium">{d.nome}</p>
                  <p className="text-xs text-texto-suave">{d.loja_nome} · v{d.versao_atual} · recebido {data(d.data_recebimento)}</p>
                </td>
                {!colaborador && <td className="px-4 py-3">{d.colaborador_id ? <Link className="text-primaria hover:underline" to={`/colaboradores/${d.colaborador_id}`}>{d.colaborador_nome ?? "—"}</Link> : "—"}</td>}
                <td className="px-4 py-3">{d.categoria_nome}<p className="text-xs text-texto-suave">Sigilo: {SIGILO[d.nivel_sigilo]}</p></td>
                <td className={vencido ? "px-4 py-3 font-medium text-perigo" : "px-4 py-3"}>{data(d.vencimento)}</td>
                <td className="px-4 py-3"><Selo tom={STATUS_DOCUMENTO[d.status]?.tom}>{STATUS_DOCUMENTO[d.status]?.rotulo ?? d.status}</Selo></td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    {d.versao_atual > 0 && <>
                      <Botao tamanho="sm" variante="fantasma" onClick={() => abrir(d, "visualizar")} aria-label={`Visualizar ${d.nome}`} icone={<Eye className="size-4" />} />
                      <Botao tamanho="sm" variante="fantasma" onClick={() => abrir(d, "download")} aria-label={`Baixar ${d.nome}`} icone={<Download className="size-4" />} />
                    </>}
                    {["recebido", "em_conferencia"].includes(d.status) && pode("documento.conferir", d.loja_id) &&
                      <Botao tamanho="sm" variante="secundaria" onClick={() => setConferindo(d)}>Conferir</Botao>}
                    {d.status !== "arquivado" && pode(`documento.${d.nivel_sigilo}.enviar`, d.loja_id) &&
                      <Botao tamanho="sm" variante="fantasma" onClick={() => setEnvio({ aberto: true, documento: d })} aria-label="Enviar nova versão" icone={<RefreshCw className="size-4" />} />}
                    {d.status !== "arquivado" && pode("documento.arquivar", d.loja_id) &&
                      <Botao tamanho="sm" variante="fantasma" onClick={() => setArquivando(d)} aria-label="Arquivar" icone={<Archive className="size-4" />} />}
                  </div>
                </td>
              </tr>
            );
          })}
        </Tabela>
      )}

      <EnvioDocumento aberto={envio.aberto} documento={envio.documento} colaborador={colaborador}
        aoFechar={() => setEnvio({ aberto: false })} aoConcluir={() => { setEnvio({ aberto: false }); recarregar(); }} />
      {conferindo && <Conferencia doc={conferindo} aoFechar={() => setConferindo(null)} aoConcluir={() => { setConferindo(null); recarregar(); }} />}
      {arquivando && <Arquivamento doc={arquivando} aoFechar={() => setArquivando(null)} aoConcluir={() => { setArquivando(null); recarregar(); }} />}
    </Cartao>
  );
}

/* ---------------- Envio ---------------- */
function EnvioDocumento({ aberto, documento, colaborador, aoFechar, aoConcluir }: {
  aberto: boolean; documento?: DocumentoLinha; colaborador?: ColaboradorLinha; aoFechar: () => void; aoConcluir: () => void;
}) {
  const { pode } = useAuth();
  const categorias = useCategorias();
  const avisar = useAvisos();
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [meta, setMeta] = useState({ categoria_id: "", nome: "", data_emissao: "", competencia: "", vencimento: "", colaborador_id: "" });
  const [motivo, setMotivo] = useState("");
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const colaboradores = useQuery({
    queryKey: ["colaboradores-envio"],
    enabled: aberto && !colaborador && !documento,
    queryFn: async () => falhar(await supabase.from("v_colaboradores").select("id,nome_completo,loja_atual_id,loja_nome")
      .not("status", "in", "(arquivado)").order("nome_completo").limit(1000)) as Pick<ColaboradorLinha, "id" | "nome_completo" | "loja_atual_id" | "loja_nome">[],
  });

  const colabSel = colaborador ?? colaboradores.data?.find((c) => c.id === meta.colaborador_id);
  const lojaAlvo = documento?.loja_id ?? colabSel?.loja_atual_id;
  const categoriasPermitidas = (categorias.data ?? []).filter((c) => lojaAlvo && pode(`documento.${c.nivel_sigilo}.enviar`, lojaAlvo));
  const cat = categorias.data?.find((c) => c.id === meta.categoria_id);
  const listaColab = useMemo(() => (colaboradores.data ?? []).filter((c) =>
    c.nome_completo.toLowerCase().includes(busca.toLowerCase())).slice(0, 50), [colaboradores.data, busca]);

  const enviar = useMutation({
    mutationFn: async () => {
      for (const a of arquivos) {
        const fd = new FormData();
        fd.append("arquivo", a);
        if (documento) {
          fd.append("documento_id", documento.id);
          fd.append("motivo", motivo);
        } else {
          fd.append("meta", JSON.stringify({
            ...meta, colaborador_id: colabSel?.id, nome: arquivos.length > 1 ? `${meta.nome || cat?.nome} — ${a.name}` : (meta.nome || a.name),
          }));
        }
        await chamarFuncao("documentos-upload", fd, false);
      }
    },
    onSuccess: () => { avisar("sucesso", arquivos.length > 1 ? `${arquivos.length} documentos enviados.` : "Documento enviado. Agora ele precisa ser conferido."); limpar(); aoConcluir(); },
    onError: (e) => setErro(mensagemErro(e)),
  });

  function limpar() {
    setArquivos([]); setMotivo(""); setErro(null); setBusca("");
    setMeta({ categoria_id: "", nome: "", data_emissao: "", competencia: "", vencimento: "", colaborador_id: "" });
  }

  function escolher(lista: FileList | null) {
    setErro(null);
    const fs = Array.from(lista ?? []);
    const invalido = fs.find((a) => !TIPOS_ACEITOS.includes(a.type) || a.size > LIMITE || a.size === 0);
    if (invalido) { setErro(`"${invalido.name}": use PDF, JPG, PNG ou WEBP de até 20 MB.`); return; }
    setArquivos(documento ? fs.slice(0, 1) : fs.slice(0, 10));
  }

  function submeter(e: FormEvent) {
    e.preventDefault();
    if (!arquivos.length) return setErro("Escolha o arquivo.");
    if (documento && !motivo.trim()) return setErro("Informe o motivo da substituição.");
    if (!documento) {
      if (!colabSel) return setErro("Escolha o colaborador.");
      if (!meta.categoria_id) return setErro("Escolha a categoria.");
      if (cat?.exige_competencia && !meta.competencia) return setErro("Esta categoria exige a competência (mês).");
      if (cat?.exige_vencimento && !meta.vencimento) return setErro("Esta categoria exige a data de vencimento.");
    }
    enviar.mutate();
  }

  return (
    <Modal aberto={aberto} aoFechar={() => { limpar(); aoFechar(); }}
      titulo={documento ? "Enviar nova versão" : "Enviar documento"}
      descricao={documento ? documento.nome : "O documento entra como “Recebido” e só vale depois de conferido."}>
      <form onSubmit={submeter} className="flex flex-col gap-4">
        {!documento && !colaborador && (
          <div>
            <Campo rotulo="Colaborador" placeholder="Digite para buscar" value={busca} onChange={(e) => { setBusca(e.target.value); setMeta((m) => ({ ...m, colaborador_id: "", categoria_id: "" })); }} obrigatorio />
            {busca && !colabSel && (
              <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-borda">
                {listaColab.map((c) => (
                  <li key={c.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-fundo"
                    onClick={() => { setMeta((m) => ({ ...m, colaborador_id: c.id })); setBusca(c.nome_completo); }}>
                    {c.nome_completo} <span className="text-texto-suave">· {c.loja_nome}</span></button></li>
                ))}
                {listaColab.length === 0 && <li className="px-3 py-2 text-sm text-texto-suave">Ninguém encontrado</li>}
              </ul>
            )}
          </div>
        )}
        {!documento && (
          <>
            <Selecao rotulo="Categoria" value={meta.categoria_id} onChange={(e) => setMeta((m) => ({ ...m, categoria_id: e.target.value }))} obrigatorio
              disabled={!lojaAlvo} dica={!lojaAlvo ? "Escolha o colaborador primeiro" : undefined}>
              <option value="">Selecione</option>
              {categoriasPermitidas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </Selecao>
            <Campo rotulo="Nome do documento" placeholder="Ex.: ASO admissional" value={meta.nome} onChange={(e) => setMeta((m) => ({ ...m, nome: e.target.value }))}
              dica="Se ficar em branco, usa o nome do arquivo." />
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo rotulo="Emissão" type="date" value={meta.data_emissao} onChange={(e) => setMeta((m) => ({ ...m, data_emissao: e.target.value }))} />
              <Campo rotulo="Competência" type="month" value={meta.competencia.slice(0, 7)} onChange={(e) => setMeta((m) => ({ ...m, competencia: e.target.value ? `${e.target.value}-01` : "" }))} obrigatorio={cat?.exige_competencia} />
              <Campo rotulo="Vencimento" type="date" value={meta.vencimento} onChange={(e) => setMeta((m) => ({ ...m, vencimento: e.target.value }))} obrigatorio={cat?.exige_vencimento} />
            </div>
          </>
        )}
        {documento && <AreaTexto rotulo="Motivo da substituição" value={motivo} onChange={(e) => setMotivo(e.target.value)} obrigatorio />}
        <div>
          <Campo rotulo={documento ? "Arquivo" : "Arquivo(s)"} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple={!documento}
            onChange={(e) => escolher(e.target.files)} dica="PDF, JPG, PNG ou WEBP · até 20 MB cada" obrigatorio />
          {arquivos.length > 1 && <p className="mt-1 text-xs text-texto-suave">{arquivos.length} arquivos — cada um vira um documento.</p>}
        </div>
        {erro && <Aviso tom="perigo">{erro}</Aviso>}
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundaria" onClick={() => { limpar(); aoFechar(); }}>Cancelar</Botao>
          <Botao type="submit" carregando={enviar.isPending}>Enviar</Botao>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- Conferência ---------------- */
function Conferencia({ doc, aoFechar, aoConcluir }: { doc: DocumentoLinha; aoFechar: () => void; aoConcluir: () => void }) {
  const avisar = useAvisos();
  const [obs, setObs] = useState("");
  const m = useMutation({
    mutationFn: async (aprovado: boolean) => {
      const { error } = await supabase.rpc("documento_conferir", { p_documento: doc.id, p_aprovado: aprovado, p_observacao: obs || null });
      if (error) throw error;
      return aprovado;
    },
    onSuccess: (ap) => { avisar("sucesso", ap ? "Documento aprovado." : "Documento reprovado."); aoConcluir(); },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  return (
    <Modal aberto aoFechar={aoFechar} titulo="Conferir documento" descricao={`${doc.nome} · ${doc.colaborador_nome ?? doc.loja_nome}`}>
      <div className="flex flex-col gap-4">
        <Aviso tom="info">Abra o arquivo antes de decidir. Sua conferência fica registrada com nome e horário.</Aviso>
        <AreaTexto rotulo="Observação" value={obs} onChange={(e) => setObs(e.target.value)} dica="Obrigatória para reprovar." />
        <div className="flex flex-wrap justify-end gap-2">
          <Botao variante="perigo" icone={<XCircle className="size-4" />} carregando={m.isPending && m.variables === false}
            disabled={!obs.trim() || m.isPending} onClick={() => m.mutate(false)}>Reprovar</Botao>
          <Botao icone={<CheckCircle2 className="size-4" />} carregando={m.isPending && m.variables === true} disabled={m.isPending} onClick={() => m.mutate(true)}>Aprovar</Botao>
        </div>
      </div>
    </Modal>
  );
}

function Arquivamento({ doc, aoFechar, aoConcluir }: { doc: DocumentoLinha; aoFechar: () => void; aoConcluir: () => void }) {
  const avisar = useAvisos();
  const [motivo, setMotivo] = useState("");
  const m = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("documento_arquivar", { p_documento: doc.id, p_motivo: motivo });
      if (error) throw error;
    },
    onSuccess: () => { avisar("sucesso", "Documento arquivado."); aoConcluir(); },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  return (
    <Modal aberto aoFechar={aoFechar} titulo="Arquivar documento" descricao="O arquivo não é apagado: continua guardado e consultável conforme a política de retenção.">
      <div className="flex flex-col gap-4">
        <AreaTexto rotulo="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} obrigatorio />
        <div className="flex justify-end gap-2">
          <Botao variante="secundaria" onClick={aoFechar}>Cancelar</Botao>
          <Botao carregando={m.isPending} disabled={!motivo.trim()} onClick={() => m.mutate()}>Arquivar</Botao>
        </div>
      </div>
    </Modal>
  );
}
