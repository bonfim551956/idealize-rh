import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Tabs from "@radix-ui/react-tabs";
import { ArrowDownToLine, ArrowUpFromLine, ClipboardCopy, ClipboardList, Pencil, Plus, Printer, RotateCcw, Shirt, Trash2, Undo2 } from "lucide-react";
import { mensagemErro, supabase } from "../lib/supabase";
import { falhar, type ColaboradorLinha } from "../lib/dados";
import { data, dataHora, hoje, type Tom } from "../lib/formato";
import { useAuth } from "../auth/AuthProvider";
import { AreaTexto, Aviso, Botao, CabecalhoPagina, Campo, Cartao, Carregando, EstadoErro, EstadoVazio, Modal, Selecao, Selo, Tabela, cx, useAvisos } from "../ui/componentes";

/* ---------------- Tipos e dados ---------------- */
export type ItemEstoque = {
  id: string; grupo: string; peca: string; tamanho: string; estoque_minimo: number; ativo: boolean;
  saldo: number; com_colaboradores: number; a_pedir: number; ultima_movimentacao: string | null;
};
type Movimento = {
  id: string; item_id: string; grupo: string; peca: string; tamanho: string; tipo: TipoMov | "estorno"; quantidade: number;
  delta: number; colaborador_id: string | null; colaborador_nome: string | null; loja_nome: string | null;
  data_movimento: string; observacao: string | null; estorno_de: string | null; estornado: boolean;
  registrado_por_nome: string | null; registrado_em: string;
};
type Posse = { colaborador_id: string; colaborador_nome: string | null; loja_nome: string | null; item_id: string; grupo: string; peca: string; tamanho: string; quantidade: number; ultima_entrega: string | null };
type TipoMov = "entrada" | "saida" | "devolucao" | "baixa" | "ajuste";

const TIPOS: Record<TipoMov | "estorno", { rotulo: string; tom: Tom }> = {
  entrada: { rotulo: "Entrada", tom: "sucesso" },
  saida: { rotulo: "Entrega", tom: "info" },
  devolucao: { rotulo: "Devolução", tom: "neutro" },
  baixa: { rotulo: "Baixa", tom: "perigo" },
  ajuste: { rotulo: "Inventário", tom: "alerta" },
  estorno: { rotulo: "Estorno", tom: "neutro" },
};

const nomeItem = (i: { peca: string; tamanho: string }) => `${i.peca} · ${i.tamanho}`;

function useEstoque() {
  return useQuery({
    queryKey: ["uniformes", "estoque"],
    queryFn: async () => falhar(await supabase.from("v_uniformes_estoque").select("*")
      .order("grupo").order("peca").order("tamanho")) as ItemEstoque[],
  });
}

function usePosse(colaborador?: string, ativo = true) {
  return useQuery({
    queryKey: ["uniformes", "posse", colaborador ?? null],
    enabled: ativo,
    queryFn: async () => {
      let r = supabase.from("v_uniformes_posse").select("*").order("colaborador_nome").order("peca").order("tamanho");
      if (colaborador) r = r.eq("colaborador_id", colaborador);
      return falhar(await r) as Posse[];
    },
  });
}

function useInvalidar() {
  const qc = useQueryClient();
  return () => ["uniformes", "timeline"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

/* ordena tamanhos de forma natural (PP, P, M, G, GG, EXG…) */
const ORDEM_TAM = ["PP", "P", "M", "G", "G1", "GG", "+GG", "EXG", "EXG1", "XG", "XGG", "ÚNICO"];
const ordemTam = (t: string) => { const i = ORDEM_TAM.indexOf(t); return i === -1 ? 99 : i; };
function ordenar(l: ItemEstoque[]) {
  return [...l].sort((a, b) => a.grupo.localeCompare(b.grupo) || a.peca.localeCompare(b.peca) || ordemTam(a.tamanho) - ordemTam(b.tamanho) || a.tamanho.localeCompare(b.tamanho));
}

/* ---------------- Página ---------------- */
type Acao =
  | { tipo: TipoMov; item?: ItemEstoque }
  | { tipo: "item"; item?: ItemEstoque }
  | { tipo: "estorno"; mov: Movimento }
  | null;

export function Uniformes() {
  const { pode, lojasCom } = useAuth();
  const estoque = useEstoque();
  const [acao, setAcao] = useState<Acao>(null);
  const entrega = pode("uniforme.movimentar");                                          // entrega/devolução (em alguma loja)
  const movimenta = entrega && lojasCom("uniforme.movimentar") === null;                // estoque central: todas as lojas
  const gere = pode("uniforme.gerir");

  const itens = useMemo(() => ordenar(estoque.data ?? []), [estoque.data]);
  const ativos = itens.filter((i) => i.ativo);
  const resumo = {
    estoque: ativos.reduce((s, i) => s + i.saldo, 0),
    comColab: itens.reduce((s, i) => s + i.com_colaboradores, 0),
    abaixo: ativos.filter((i) => i.saldo < i.estoque_minimo).length,
    aPedir: ativos.reduce((s, i) => s + i.a_pedir, 0),
  };

  return (
    <>
      <CabecalhoPagina titulo="Uniformes" descricao="Estoque central. O saldo é calculado pelas entradas e saídas registradas, e cada entrega fica na ficha do colaborador."
        acoes={entrega && <>
          <Botao icone={<ArrowUpFromLine className="size-4" />} onClick={() => setAcao({ tipo: "saida" })}>Entregar ao colaborador</Botao>
          {movimenta && <Botao variante="secundaria" icone={<ArrowDownToLine className="size-4" />} onClick={() => setAcao({ tipo: "entrada" })}>Registrar entrada</Botao>}
          <Botao variante="secundaria" icone={<Undo2 className="size-4" />} onClick={() => setAcao({ tipo: "devolucao" })}>Devolução</Botao>
        </>} />

      {estoque.isLoading && <Carregando />}
      {estoque.error && <EstadoErro mensagem={(estoque.error as Error).message} tentarNovamente={() => estoque.refetch()} />}
      {estoque.data && <>
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Numero rotulo="Peças em estoque" valor={resumo.estoque} />
          <Numero rotulo="Com colaboradores" valor={resumo.comColab} />
          <Numero rotulo="Itens abaixo do mínimo" valor={resumo.abaixo} tom={resumo.abaixo ? "alerta" : "sucesso"} />
          <Numero rotulo="Peças a pedir" valor={resumo.aPedir} tom={resumo.aPedir ? "alerta" : "sucesso"} />
        </div>

        <Tabs.Root defaultValue="estoque">
          <Tabs.List className="mb-6 flex gap-1 overflow-x-auto border-b border-borda" aria-label="Seções de uniformes">
            {[["estoque", "Estoque"], ["pedido", `Pedido de compra${resumo.aPedir ? ` (${resumo.aPedir})` : ""}`], ["colaboradores", "Com colaboradores"], ["movimentos", "Movimentações"]].map(([v, r]) => (
              <Tabs.Trigger key={v} value={v}
                className="h-10 shrink-0 border-b-2 border-transparent px-3 text-sm font-medium text-texto-suave hover:text-texto data-[state=active]:border-primaria data-[state=active]:text-primaria">{r}</Tabs.Trigger>
            ))}
          </Tabs.List>
          <Tabs.Content value="estoque"><Estoque itens={itens} movimenta={movimenta} gere={gere} setAcao={setAcao} /></Tabs.Content>
          <Tabs.Content value="pedido"><Pedido itens={ativos} /></Tabs.Content>
          <Tabs.Content value="colaboradores"><ComColaboradores /></Tabs.Content>
          <Tabs.Content value="movimentos"><Movimentacoes movimenta={movimenta} setAcao={setAcao} /></Tabs.Content>
        </Tabs.Root>
      </>}

      {acao && (acao.tipo === "item"
        ? <ItemModal item={acao.item} fechar={() => setAcao(null)} />
        : acao.tipo === "estorno"
          ? <EstornoModal mov={acao.mov} fechar={() => setAcao(null)} />
          : <MovimentoModal tipo={acao.tipo} item={acao.item} itens={itens} fechar={() => setAcao(null)} />)}
    </>
  );
}

function Numero({ rotulo, valor, tom }: { rotulo: string; valor: number; tom?: Tom }) {
  const cor = tom === "alerta" ? "text-alerta" : tom === "sucesso" ? "text-sucesso" : "text-texto";
  return (
    <div className="rounded-xl border border-borda bg-superficie p-4">
      <p className="text-xs text-texto-suave">{rotulo}</p>
      <p className={cx("mt-1 text-2xl font-semibold tabular-nums", cor)}>{valor}</p>
    </div>
  );
}

function SeloSaldo({ i }: { i: ItemEstoque }) {
  if (!i.ativo) return <Selo>Desativada</Selo>;
  if (i.saldo === 0) return <Selo tom="perigo">Zerado</Selo>;
  if (i.saldo < i.estoque_minimo) return <Selo tom="alerta">Abaixo do mínimo</Selo>;
  return <Selo tom="sucesso">OK</Selo>;
}

/* ---------------- Estoque ---------------- */
function Estoque({ itens, movimenta, gere, setAcao }: { itens: ItemEstoque[]; movimenta: boolean; gere: boolean; setAcao: (a: Acao) => void }) {
  const [verInativos, setVerInativos] = useState(false);
  const lista = itens.filter((i) => verInativos || i.ativo);
  const grupos = [...new Set(lista.map((i) => i.grupo))];
  return (
    <Cartao acao={<div className="flex flex-wrap items-center gap-3">
      {itens.some((i) => !i.ativo) && <label className="flex items-center gap-2 text-sm text-texto-suave">
        <input type="checkbox" checked={verInativos} onChange={(e) => setVerInativos(e.target.checked)} className="size-4 accent-primaria" /> Mostrar desativadas</label>}
      {gere && <Botao tamanho="sm" icone={<Plus className="size-4" />} onClick={() => setAcao({ tipo: "item" })}>Nova peça / tamanho</Botao>}
    </div>} titulo="Estoque atual">
      {lista.length === 0 && <EstadoVazio titulo="Nenhuma peça cadastrada" descricao="Cadastre as peças e tamanhos e registre a entrada do saldo atual." />}
      {grupos.map((g) => (
        <div key={g} className="mb-6 last:mb-0">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-texto-suave">{g}</h3>
          <Tabela cabecalho={["Peça", "Tamanho", "Em estoque", "Mínimo", "A pedir", "Com colaboradores", "Situação", ""]}>
            {lista.filter((i) => i.grupo === g).map((i) => (
              <tr key={i.id} className={cx("hover:bg-fundo", !i.ativo && "opacity-60")}>
                <td className="px-4 py-3 font-medium">{i.peca}</td>
                <td className="px-4 py-3">{i.tamanho}</td>
                <td className="px-4 py-3 text-base font-semibold tabular-nums">{i.saldo}</td>
                <td className="px-4 py-3 tabular-nums">{i.estoque_minimo}</td>
                <td className={cx("px-4 py-3 tabular-nums", i.a_pedir > 0 && "font-semibold text-alerta")}>{i.a_pedir || "—"}</td>
                <td className="px-4 py-3 tabular-nums">{i.com_colaboradores || "—"}</td>
                <td className="px-4 py-3"><SeloSaldo i={i} /></td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    {movimenta && i.ativo && <>
                      <Botao tamanho="sm" variante="fantasma" onClick={() => setAcao({ tipo: "ajuste", item: i })} aria-label={`Inventário de ${nomeItem(i)}`} title="Inventário (contagem)" icone={<ClipboardList className="size-4" />} />
                      <Botao tamanho="sm" variante="fantasma" disabled={i.saldo === 0} onClick={() => setAcao({ tipo: "baixa", item: i })} aria-label={`Baixa de ${nomeItem(i)}`} title="Baixa (descarte/perda)" icone={<Trash2 className="size-4" />} />
                    </>}
                    {gere && <Botao tamanho="sm" variante="fantasma" onClick={() => setAcao({ tipo: "item", item: i })} aria-label={`Editar ${nomeItem(i)}`} title="Editar / mínimo" icone={<Pencil className="size-4" />} />}
                  </div>
                </td>
              </tr>
            ))}
          </Tabela>
        </div>
      ))}
    </Cartao>
  );
}

/* ---------------- Pedido de compra ---------------- */
function Pedido({ itens }: { itens: ItemEstoque[] }) {
  const avisar = useAvisos();
  const lista = itens.filter((i) => i.a_pedir > 0);
  const total = lista.reduce((s, i) => s + i.a_pedir, 0);
  const texto = () => {
    const grupos = [...new Set(lista.map((i) => i.grupo))];
    return [`PEDIDO DE UNIFORMES · ${data(hoje())}`, "",
      ...grupos.flatMap((g) => [g, ...lista.filter((i) => i.grupo === g).map((i) => `- ${i.peca} ${i.tamanho}: ${i.a_pedir}`), ""]),
      `TOTAL: ${total} PEÇAS`].join("\n");
  };
  async function copiar() {
    try { await navigator.clipboard.writeText(texto()); avisar("sucesso", "Lista copiada. É só colar no WhatsApp ou e-mail do fornecedor."); }
    catch { avisar("erro", "Não foi possível copiar. Selecione o texto e copie manualmente."); }
  }
  function imprimir() {
    const w = window.open("", "_blank");
    if (!w) return;
    const pre = w.document.createElement("pre");
    pre.textContent = texto();
    pre.style.cssText = "font:14px/1.5 system-ui,sans-serif;white-space:pre-wrap;margin:32px";
    w.document.title = "Pedido de uniformes";
    w.document.body.appendChild(pre);
    w.print();
  }
  return (
    <Cartao titulo="O que pedir para voltar ao mínimo"
      acao={lista.length > 0 && <div className="flex gap-2">
        <Botao tamanho="sm" variante="secundaria" icone={<ClipboardCopy className="size-4" />} onClick={copiar}>Copiar lista</Botao>
        <Botao tamanho="sm" variante="secundaria" icone={<Printer className="size-4" />} onClick={imprimir}>Imprimir</Botao>
      </div>}>
      {lista.length === 0
        ? <EstadoVazio titulo="Estoque completo" descricao="Todas as peças estão no mínimo ou acima dele." />
        : <>
          <Aviso tom="info">A quantidade a pedir é o estoque mínimo menos o que há em estoque agora. Peças com colaboradores não entram na conta.</Aviso>
          <div className="mt-4"><Tabela cabecalho={["Grupo", "Peça", "Tamanho", "Em estoque", "Mínimo", "Pedir"]}>
            {lista.map((i) => (
              <tr key={i.id}>
                <td className="px-4 py-3 text-texto-suave">{i.grupo}</td>
                <td className="px-4 py-3 font-medium">{i.peca}</td>
                <td className="px-4 py-3">{i.tamanho}</td>
                <td className="px-4 py-3 tabular-nums">{i.saldo}</td>
                <td className="px-4 py-3 tabular-nums">{i.estoque_minimo}</td>
                <td className="px-4 py-3 text-base font-semibold tabular-nums text-alerta">{i.a_pedir}</td>
              </tr>
            ))}
            <tr className="bg-fundo"><td className="px-4 py-3 font-semibold" colSpan={5}>Total</td><td className="px-4 py-3 text-base font-semibold tabular-nums">{total}</td></tr>
          </Tabela></div>
        </>}
    </Cartao>
  );
}

/* ---------------- Com colaboradores ---------------- */
function ComColaboradores() {
  const q = usePosse();
  const porColab = useMemo(() => {
    const m = new Map<string, { nome: string; loja: string; itens: Posse[] }>();
    (q.data ?? []).forEach((p) => {
      const g = m.get(p.colaborador_id) ?? { nome: p.colaborador_nome ?? "—", loja: p.loja_nome ?? "", itens: [] };
      g.itens.push(p); m.set(p.colaborador_id, g);
    });
    return [...m.entries()];
  }, [q.data]);
  return (
    <Cartao titulo="Peças em mãos de cada colaborador">
      {q.isLoading && <Carregando />}
      {q.error && <EstadoErro mensagem={(q.error as Error).message} tentarNovamente={() => q.refetch()} />}
      {q.data?.length === 0 && <EstadoVazio titulo="Nenhuma peça entregue ainda" descricao="Use “Entregar ao colaborador” para registrar quem recebeu cada peça." />}
      {porColab.length > 0 && (
        <ul className="divide-y divide-borda">
          {porColab.map(([id, g]) => (
            <li key={id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <Link to={`/colaboradores/${id}`} className="font-medium text-primaria hover:underline">{g.nome}</Link>
                <p className="text-xs text-texto-suave">{g.loja}</p>
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                {g.itens.map((p) => <Selo key={p.item_id} tom="info">{p.quantidade}× {p.peca} {p.tamanho}</Selo>)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}

/* ---------------- Movimentações ---------------- */
function Movimentacoes({ movimenta, setAcao, colaborador }: { movimenta: boolean; setAcao: (a: Acao) => void; colaborador?: string }) {
  const [tipo, setTipo] = useState("");
  const q = useQuery({
    queryKey: ["uniformes", "movimentos", colaborador ?? null, tipo],
    queryFn: async () => {
      let r = supabase.from("v_uniformes_movimentos").select("*").order("data_movimento", { ascending: false }).order("registrado_em", { ascending: false }).limit(300);
      if (colaborador) r = r.eq("colaborador_id", colaborador);
      if (tipo) r = r.eq("tipo", tipo);
      return falhar(await r) as Movimento[];
    },
  });
  return (
    <Cartao titulo={colaborador ? "Histórico de uniformes" : "Movimentações"}
      acao={!colaborador && <div className="w-44"><Selecao rotulo="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
        <option value="">Todos</option>
        {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}
      </Selecao></div>}>
      {q.isLoading && <Carregando />}
      {q.error && <EstadoErro mensagem={(q.error as Error).message} tentarNovamente={() => q.refetch()} />}
      {q.data?.length === 0 && <EstadoVazio titulo="Nenhuma movimentação" />}
      {!!q.data?.length && (
        <Tabela cabecalho={colaborador ? ["Data", "Tipo", "Peça", "Qtd.", "Observação", "Registrado por", ""] : ["Data", "Tipo", "Peça", "Qtd.", "Colaborador", "Observação", "Registrado por", ""]}>
          {q.data.map((m) => (
            <tr key={m.id} className={cx("hover:bg-fundo", m.estornado && "opacity-60")}>
              <td className="px-4 py-3 whitespace-nowrap">{data(m.data_movimento)}</td>
              <td className="px-4 py-3"><Selo tom={TIPOS[m.tipo].tom}>{TIPOS[m.tipo].rotulo}</Selo>{m.estornado && <p className="mt-1 text-xs text-texto-suave">estornada</p>}</td>
              <td className="px-4 py-3"><p className="font-medium">{nomeItem(m)}</p><p className="text-xs text-texto-suave">{m.grupo}</p></td>
              <td className={cx("px-4 py-3 font-semibold tabular-nums", m.delta > 0 ? "text-sucesso" : m.delta < 0 ? "text-perigo" : "")}>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
              {!colaborador && <td className="px-4 py-3">{m.colaborador_id ? <Link to={`/colaboradores/${m.colaborador_id}`} className="text-primaria hover:underline">{m.colaborador_nome ?? "—"}</Link> : "—"}{m.loja_nome && <p className="text-xs text-texto-suave">{m.loja_nome}</p>}</td>}
              <td className="max-w-xs px-4 py-3 text-texto-suave">{m.observacao ?? "—"}</td>
              <td className="px-4 py-3 text-xs text-texto-suave">{m.registrado_por_nome ?? "—"}<br />{dataHora(m.registrado_em)}</td>
              <td className="px-4 py-3 text-right">
                {movimenta && m.tipo !== "estorno" && !m.estornado &&
                  <Botao tamanho="sm" variante="fantasma" onClick={() => setAcao({ tipo: "estorno", mov: m })} aria-label="Estornar" title="Estornar (desfazer lançamento errado)" icone={<RotateCcw className="size-4" />} />}
              </td>
            </tr>
          ))}
        </Tabela>
      )}
    </Cartao>
  );
}

/* ---------------- Modal de movimentação ---------------- */
type Colab = { id: string; nome_completo: string; loja_nome: string; status: string | null };
const TITULOS: Record<TipoMov, { titulo: string; descricao: string; botao: string }> = {
  entrada: { titulo: "Registrar entrada", descricao: "Peças que chegaram ao estoque (compra ou recebimento).", botao: "Registrar entrada" },
  saida: { titulo: "Entregar ao colaborador", descricao: "Sai do estoque e fica registrado na ficha do colaborador.", botao: "Registrar entrega" },
  devolucao: { titulo: "Devolução", descricao: "O colaborador devolveu peças. Elas voltam ao estoque.", botao: "Registrar devolução" },
  baixa: { titulo: "Baixa de estoque", descricao: "Peça descartada, perdida ou danificada. Sai do estoque sem ir para ninguém.", botao: "Registrar baixa" },
  ajuste: { titulo: "Inventário (contagem)", descricao: "Informe quantas peças você contou. O sistema lança só a diferença.", botao: "Salvar contagem" },
};

export function MovimentoModal({ tipo, item, itens, colaboradorFixo, fechar }: {
  tipo: TipoMov; item?: ItemEstoque; itens: ItemEstoque[]; colaboradorFixo?: ColaboradorLinha; fechar: () => void;
}) {
  const avisar = useAvisos();
  const invalidar = useInvalidar();
  const comColab = tipo === "saida" || tipo === "devolucao";
  const unico = tipo === "baixa" || tipo === "ajuste";
  const [colab, setColab] = useState(colaboradorFixo?.id ?? "");
  const [busca, setBusca] = useState("");
  const [dataMov, setDataMov] = useState(hoje());
  const [obs, setObs] = useState("");
  const [linhas, setLinhas] = useState<{ item_id: string; quantidade: string }[]>([{ item_id: item?.id ?? "", quantidade: unico && item ? String(tipo === "ajuste" ? item.saldo : 1) : "1" }]);

  const colaboradores = useQuery({
    queryKey: ["colaboradores", "uniformes"],
    enabled: comColab && !colaboradorFixo,
    queryFn: async () => falhar(await supabase.from("v_colaboradores").select("id,nome_completo,loja_nome,status").order("nome_completo")) as Colab[],
  });
  const posse = usePosse(colab || undefined, tipo === "devolucao" && !!colab);

  const disponiveis = tipo === "devolucao"
    ? (posse.data ?? []).map((p) => ({ id: p.item_id, rotulo: `${p.grupo} · ${nomeItem(p)} (com ele: ${p.quantidade})`, max: p.quantidade }))
    : itens.filter((i) => i.ativo || unico).map((i) => ({ id: i.id, rotulo: `${i.grupo} · ${nomeItem(i)} (estoque: ${i.saldo})`, max: tipo === "saida" || tipo === "baixa" ? i.saldo : undefined }));

  const listaColab = (colaboradores.data ?? []).filter((c) => !["desligado", "arquivado"].includes(c.status ?? "") || c.id === colab)
    .filter((c) => !busca || c.nome_completo.includes(busca.toUpperCase()));

  const m = useMutation({
    mutationFn: async () => {
      const { error, data: n } = await supabase.rpc("uniforme_movimentar", {
        p_tipo: tipo,
        p_itens: linhas.map((l) => ({ item_id: l.item_id, quantidade: Number(l.quantidade) })),
        p_colaborador: comColab ? colab : null,
        p_data: dataMov,
        p_observacao: obs || null,
      });
      if (error) throw error;
      return n as number;
    },
    onSuccess: (n) => {
      invalidar();
      avisar("sucesso", tipo === "ajuste" && n === 0 ? "Contagem confere com o sistema. Nada a ajustar." : `${TITULOS[tipo].botao.replace("Registrar ", "").replace("Salvar ", "")}: registrado.`);
      fechar();
    },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });

  const erroLinha = (l: { item_id: string; quantidade: string }) => {
    const q = Number(l.quantidade);
    if (!l.item_id) return null;
    if (!Number.isInteger(q) || q < (tipo === "ajuste" ? 0 : 1)) return "Quantidade inválida";
    const d = disponiveis.find((x) => x.id === l.item_id);
    if (d?.max !== undefined && q > d.max) return tipo === "devolucao" ? `Ele só tem ${d.max}` : `Só há ${d.max} em estoque`;
    return null;
  };
  const repetido = new Set(linhas.map((l) => l.item_id)).size !== linhas.length;
  const valido = (!comColab || colab) && linhas.every((l) => l.item_id && !erroLinha(l)) && !repetido && (!unico || obs.trim());

  function enviar(e: FormEvent) { e.preventDefault(); if (valido) m.mutate(); }
  const t = TITULOS[tipo];

  return (
    <Modal aberto aoFechar={fechar} titulo={t.titulo} descricao={t.descricao} largura="max-w-2xl">
      <form onSubmit={enviar} className="flex flex-col gap-4">
        {comColab && (colaboradorFixo
          ? <Aviso tom="info">Colaborador: <strong>{colaboradorFixo.nome_completo}</strong> · {colaboradorFixo.loja_nome}</Aviso>
          : <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Buscar colaborador" placeholder="Digite parte do nome" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <Selecao rotulo="Colaborador" obrigatorio value={colab} onChange={(e) => { setColab(e.target.value); if (tipo === "devolucao") setLinhas([{ item_id: "", quantidade: "1" }]); }}>
              <option value="">{colaboradores.isLoading ? "Carregando…" : "Selecione"}</option>
              {listaColab.map((c) => <option key={c.id} value={c.id}>{c.nome_completo} · {c.loja_nome}</option>)}
            </Selecao>
          </div>)}

        {tipo === "devolucao" && colab && posse.data?.length === 0 && <Aviso tom="alerta">Este colaborador não tem peças registradas em mãos.</Aviso>}

        <div className="flex flex-col gap-3">
          {linhas.map((l, n) => (
            <div key={n} className="grid grid-cols-[1fr_96px_auto] items-start gap-2">
              <Selecao id={`peca-${n}`} rotulo={n === 0 ? "Peça e tamanho" : " "} value={l.item_id} disabled={unico && !!item}
                onChange={(e) => setLinhas(linhas.map((x, k) => k === n ? { ...x, item_id: e.target.value } : x))}>
                <option value="">Selecione</option>
                {disponiveis.map((d) => <option key={d.id} value={d.id}>{d.rotulo}</option>)}
              </Selecao>
              <Campo id={`qtd-${n}`} rotulo={n === 0 ? (tipo === "ajuste" ? "Contado" : "Qtd.") : " "} type="number" min={tipo === "ajuste" ? 0 : 1} inputMode="numeric"
                value={l.quantidade} erro={erroLinha(l)} onChange={(e) => setLinhas(linhas.map((x, k) => k === n ? { ...x, quantidade: e.target.value } : x))} />
              <div className="pt-6">
                {linhas.length > 1 && <Botao type="button" tamanho="sm" variante="fantasma" aria-label="Remover peça" icone={<Trash2 className="size-4" />}
                  onClick={() => setLinhas(linhas.filter((_, k) => k !== n))} />}
              </div>
            </div>
          ))}
          {repetido && <p className="text-xs text-perigo" role="alert">A mesma peça aparece duas vezes. Some as quantidades numa linha só.</p>}
          {!unico && <div><Botao type="button" tamanho="sm" variante="secundaria" icone={<Plus className="size-4" />}
            onClick={() => setLinhas([...linhas, { item_id: "", quantidade: "1" }])}>Adicionar outra peça</Botao></div>}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Data" type="date" max={hoje()} value={dataMov} onChange={(e) => setDataMov(e.target.value)} obrigatorio />
        </div>
        <AreaTexto rotulo={unico ? "Motivo" : "Observação"} obrigatorio={unico} value={obs} onChange={(e) => setObs(e.target.value)}
          dica={tipo === "entrada" ? "Ex.: fornecedor, número da nota" : tipo === "baixa" ? "Ex.: peça rasgada, perdida" : tipo === "ajuste" ? "Ex.: inventário mensal" : undefined} />
        <div className="flex justify-end gap-2 pt-2">
          <Botao type="button" variante="secundaria" onClick={fechar}>Cancelar</Botao>
          <Botao type="submit" carregando={m.isPending} disabled={!valido}>{t.botao}</Botao>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- Peça / tamanho ---------------- */
function ItemModal({ item, fechar }: { item?: ItemEstoque; fechar: () => void }) {
  const avisar = useAvisos();
  const invalidar = useInvalidar();
  const [f, setF] = useState({ grupo: item?.grupo ?? "UNIFORMES", peca: item?.peca ?? "", tamanho: item?.tamanho ?? "", minimo: String(item?.estoque_minimo ?? 12), ativo: item?.ativo ?? true });
  const m = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("uniforme_item_salvar", {
        p_id: item?.id ?? null, p_grupo: f.grupo, p_peca: f.peca, p_tamanho: f.tamanho, p_estoque_minimo: Number(f.minimo), p_ativo: f.ativo,
      });
      if (error) throw error;
    },
    onSuccess: () => { invalidar(); avisar("sucesso", item ? "Peça atualizada." : "Peça cadastrada. Registre a entrada para lançar o saldo."); fechar(); },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  const minimoOk = Number.isInteger(Number(f.minimo)) && Number(f.minimo) >= 0;
  const valido = f.grupo.trim() && f.peca.trim() && f.tamanho.trim() && minimoOk;
  return (
    <Modal aberto aoFechar={fechar} titulo={item ? "Editar peça" : "Nova peça / tamanho"} descricao="Cada tamanho é um item com seu próprio estoque mínimo.">
      <form onSubmit={(e) => { e.preventDefault(); if (valido) m.mutate(); }} className="flex flex-col gap-4">
        <Campo rotulo="Grupo" obrigatorio value={f.grupo} onChange={(e) => setF({ ...f, grupo: e.target.value })} dica="Ex.: UNIFORMES, TREINAMENTO" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Peça" obrigatorio value={f.peca} onChange={(e) => setF({ ...f, peca: e.target.value })} placeholder="Ex.: POLO FEMININO" />
          <Campo rotulo="Tamanho" obrigatorio value={f.tamanho} onChange={(e) => setF({ ...f, tamanho: e.target.value })} placeholder="Ex.: M" />
        </div>
        <Campo rotulo="Estoque mínimo" type="number" min={0} inputMode="numeric" obrigatorio value={f.minimo}
          erro={minimoOk ? null : "Informe um número inteiro"} onChange={(e) => setF({ ...f, minimo: e.target.value })}
          dica="Quando o estoque ficar abaixo disso, a diferença entra no pedido de compra." />
        {item && <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} className="size-4 accent-primaria" />
          Peça ativa (desmarque para parar de usar; o histórico é mantido)</label>}
        <div className="flex justify-end gap-2 pt-2">
          <Botao type="button" variante="secundaria" onClick={fechar}>Cancelar</Botao>
          <Botao type="submit" carregando={m.isPending} disabled={!valido}>Salvar</Botao>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- Estorno ---------------- */
function EstornoModal({ mov, fechar }: { mov: Movimento; fechar: () => void }) {
  const avisar = useAvisos();
  const invalidar = useInvalidar();
  const [motivo, setMotivo] = useState("");
  const m = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc("uniforme_estornar", { p_movimento: mov.id, p_motivo: motivo }); if (error) throw error; },
    onSuccess: () => { invalidar(); avisar("sucesso", "Lançamento estornado."); fechar(); },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  return (
    <Modal aberto aoFechar={fechar} titulo="Estornar lançamento"
      descricao={`${TIPOS[mov.tipo].rotulo} de ${mov.quantidade} ${nomeItem(mov)} em ${data(mov.data_movimento)}${mov.colaborador_nome ? ` · ${mov.colaborador_nome}` : ""}`}>
      <div className="flex flex-col gap-4">
        <Aviso tom="alerta">O lançamento original não é apagado. É criado um lançamento contrário, e os dois ficam no histórico.</Aviso>
        <AreaTexto rotulo="Motivo" obrigatorio value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Botao variante="secundaria" onClick={fechar}>Cancelar</Botao>
          <Botao variante="perigo" carregando={m.isPending} disabled={!motivo.trim()} onClick={() => m.mutate()}>Estornar</Botao>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- Aba na ficha do colaborador ---------------- */
export function UniformesColaborador({ c }: { c: ColaboradorLinha }) {
  const { pode, lojasCom } = useAuth();
  const posse = usePosse(c.id);
  const estoque = useEstoque();
  const [acao, setAcao] = useState<Acao>(null);
  const entrega = pode("uniforme.movimentar", c.loja_atual_id);
  const movimenta = entrega && lojasCom("uniforme.movimentar") === null;
  const encerrado = c.status === "desligado" || c.status === "arquivado";
  const total = (posse.data ?? []).reduce((s, p) => s + p.quantidade, 0);
  return (
    <div className="flex flex-col gap-6">
      <Cartao titulo={<span className="flex items-center gap-2"><Shirt className="size-4" /> Em mãos agora{total ? ` (${total})` : ""}</span>}
        acao={entrega && <div className="flex gap-2">
          {!encerrado && <Botao tamanho="sm" icone={<ArrowUpFromLine className="size-4" />} onClick={() => setAcao({ tipo: "saida" })}>Entregar</Botao>}
          {total > 0 && <Botao tamanho="sm" variante="secundaria" icone={<Undo2 className="size-4" />} onClick={() => setAcao({ tipo: "devolucao" })}>Devolução</Botao>}
        </div>}>
        {posse.isLoading && <Carregando />}
        {posse.error && <EstadoErro mensagem={(posse.error as Error).message} />}
        {posse.data?.length === 0 && <p className="text-sm text-texto-suave">Nenhuma peça registrada com este colaborador.</p>}
        {!!posse.data?.length && (
          <ul className="divide-y divide-borda">
            {posse.data.map((p) => (
              <li key={p.item_id} className="flex items-center justify-between py-2 text-sm">
                <span><span className="font-medium">{nomeItem(p)}</span> <span className="text-texto-suave">· {p.grupo}</span></span>
                <span className="text-right"><span className="font-semibold tabular-nums">{p.quantidade}</span>
                  {p.ultima_entrega && <span className="block text-xs text-texto-suave">última entrega {data(p.ultima_entrega)}</span>}</span>
              </li>
            ))}
          </ul>
        )}
        {encerrado && total > 0 && <div className="mt-3"><Aviso tom="alerta">Colaborador desligado com peças em mãos. Registre a devolução ou a baixa.</Aviso></div>}
      </Cartao>
      <Movimentacoes movimenta={movimenta} setAcao={setAcao} colaborador={c.id} />
      {acao && acao.tipo === "estorno" && <EstornoModal mov={acao.mov} fechar={() => setAcao(null)} />}
      {acao && (acao.tipo === "saida" || acao.tipo === "devolucao") &&
        <MovimentoModal tipo={acao.tipo} itens={ordenar(estoque.data ?? [])} colaboradorFixo={c} fechar={() => setAcao(null)} />}
    </div>
  );
}
