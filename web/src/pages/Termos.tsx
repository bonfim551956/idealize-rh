/* Termos oficiais da Óticas Idealize gerados a partir da ficha do colaborador.
 * Dados pessoais (CPF, RG, endereço) vêm da ficha; o que não é pessoal (itens entregues, CA do EPI,
 * acessórios, estado, tipo de entrega) é conferido/completado aqui por quem cuida do RH antes de imprimir. */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, HardHat, Laptop, Plus, Printer, Shirt, Trash2, type LucideIcon } from "lucide-react";
import { supabase } from "../lib/supabase";
import { falhar, useEmpresas, useLojas, type ColaboradorLinha } from "../lib/dados";
import { data as dataBR, hoje } from "../lib/formato";
import { useAuth } from "../auth/AuthProvider";
import { Aviso, Botao, Campo, Carregando, Modal, cx } from "../ui/componentes";

export type TipoTermo = "imagem" | "uniforme" | "equipamento" | "epi";

const TIPOS: Record<TipoTermo, { rotulo: string; descricao: string; icone: LucideIcon }> = {
  uniforme: { rotulo: "Recebimento de uniforme", descricao: "Peças entregues, tipo de entrega e próxima renovação", icone: Shirt },
  epi: { rotulo: "Entrega e responsabilidade de EPI", descricao: "EPIs com nº do CA e validade (NR-6)", icone: HardHat },
  equipamento: { rotulo: "Recebimento de equipamento", descricao: "Notebook, celular, linha, tablet e acessórios", icone: Laptop },
  imagem: { rotulo: "Autorização de uso de imagem e voz", descricao: "Preenchido só com os dados da ficha", icone: Camera },
};

type Linha = Record<string, string>;
type Ficha = { completo?: boolean; cpf?: string | null; rg?: string | null; rg_orgao?: string | null;
  logradouro?: string | null; numero?: string | null; complemento?: string | null; bairro?: string | null;
  cidade?: string | null; uf?: string | null; cep?: string | null };

const somaMeses = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); };
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const porExtenso = (iso: string) => { const [a, m, d] = iso.split("-"); return `${Number(d)} de ${MESES[Number(m) - 1]} de ${a}`; };
const cpfFmt = (v?: string | null) => { const d = (v ?? "").replace(/\D/g, ""); return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : ""; };
const cnpjFmt = (v?: string | null) => { const d = (v ?? "").replace(/\D/g, ""); return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : v ?? ""; };
const EPI_RE = /\bEPI\b|LUVA|ÓCULOS DE PROTE|OCULOS DE PROTE|AVENTAL|MÁSCARA|MASCARA|PROTETOR|BOTA|CAPACETE|RESPIRADOR/i;

/* ------------------------------------------------------------------ */
/* Modal: escolher o termo, conferir os dados não pessoais e imprimir  */
/* ------------------------------------------------------------------ */
export function GerarTermo({ c, tipoInicial, fechar }: { c: ColaboradorLinha; tipoInicial?: TipoTermo; fechar: () => void }) {
  const { pode } = useAuth();
  const loja = c.loja_atual_id;
  const [tipo, setTipo] = useState<TipoTermo | null>(tipoInicial ?? null);
  const lojas = useLojas(); const empresas = useEmpresas();
  useEffect(() => { carregarLogo(); }, []);
  const ficha = useQuery({
    queryKey: ["termo-ficha", c.id],
    queryFn: async () => {
      const { data: r, error } = await supabase.rpc("colaborador_ficha", { p_colaborador: c.id, p_completo: pode("colaborador.dados_pessoais.ler", loja) });
      if (error) throw new Error(error.message);
      return r as Ficha;
    },
  });
  const equipamentos = useQuery({
    queryKey: ["equipamentos", c.id], enabled: pode("equipamento.ler", loja),
    queryFn: async () => falhar(await supabase.from("equipamentos").select("*").eq("colaborador_id", c.id).order("data_entrega", { ascending: false })) as
      { tipo: string; descricao: string | null; identificacao: string | null; quantidade: number; data_entrega: string; devolvido_em: string | null; cancelado: boolean }[],
  });
  const posse = useQuery({
    queryKey: ["uniformes", "posse", c.id], enabled: pode("uniforme.ler", loja),
    queryFn: async () => falhar(await supabase.from("v_uniformes_posse").select("*").eq("colaborador_id", c.id).order("peca")) as
      { peca: string; tamanho: string; quantidade: number; ultima_entrega: string | null }[],
  });

  const lj = lojas.data?.find((l) => l.id === loja);
  const emp = empresas.data?.find((e) => e.id === c.empresa_id) ?? (lj?.empresas ? { razao_social: lj.empresas.razao_social, cnpj: lj.empresas.cnpj } : null);
  const f = ficha.data ?? {};
  const cpf = cpfFmt(f.cpf);

  // campos comuns
  const [dataTermo, setDataTermo] = useState(hoje());
  // uniforme
  const sugestaoUni = /MONTA/i.test(c.cargo_nome ?? "") ? "kit_montagem"
    : c.data_admissao && (Date.now() - new Date(`${c.data_admissao}T12:00:00`).getTime()) < 35 * 86400e3 ? "onboarding" : "kit_definitivo";
  const [tipoUni, setTipoUni] = useState<string>(sugestaoUni);
  const [itensUni, setItensUni] = useState<Linha[] | null>(null);
  const [dataUni, setDataUni] = useState<string>("");
  const [renovUni, setRenovUni] = useState<string>("");
  // equipamento / EPI
  const [itensEq, setItensEq] = useState<Linha[] | null>(null);
  const [outroEq, setOutroEq] = useState("");
  const [itensEpi, setItensEpi] = useState<Linha[] | null>(null);

  // pré-preenche com o que já está lançado no sistema
  useEffect(() => {
    if (itensUni === null && posse.isFetched) {
      const p = posse.data ?? [];
      setItensUni(p.length ? p.map((x) => ({ item: x.peca, tamanho: x.tamanho, qtd: String(x.quantidade), estado: "NOVO" })) : [{ item: "", tamanho: "", qtd: "1", estado: "NOVO" }]);
      const ult = p.map((x) => x.ultima_entrega).filter(Boolean).sort().pop() ?? hoje();
      setDataUni(ult as string); setRenovUni(somaMeses(ult as string, 8));
    }
  }, [posse.isFetched, posse.data, itensUni]);
  useEffect(() => {
    if (itensEq === null && (equipamentos.isFetched || !pode("equipamento.ler", loja))) {
      const ativos = (equipamentos.data ?? []).filter((e) => !e.cancelado && !e.devolvido_em && !/^CRACH/i.test(e.tipo));
      const eq = ativos.filter((e) => !EPI_RE.test(`${e.tipo} ${e.descricao ?? ""}`));
      const epi = ativos.filter((e) => EPI_RE.test(`${e.tipo} ${e.descricao ?? ""}`));
      setItensEq(eq.length ? eq.map((e) => ({ item: [e.tipo, e.descricao].filter(Boolean).join(" · "), patrimonio: e.identificacao ?? "", qtd: String(e.quantidade),
        acessorios: "", estado: "BOM", data: e.data_entrega })) : [{ item: "", patrimonio: "", qtd: "1", acessorios: "", estado: "BOM", data: hoje() }]);
      setItensEpi(epi.length ? epi.map((e) => ({ epi: [e.tipo, e.descricao].filter(Boolean).join(" · "), ca: "", qtd: String(e.quantidade), data: e.data_entrega, validade: "" }))
        : [{ epi: "", ca: "", qtd: "1", data: hoje(), validade: "" }]);
    }
  }, [equipamentos.isFetched, equipamentos.data, itensEq, pode, loja]);

  const carregando = ficha.isLoading || lojas.isLoading || empresas.isLoading || (tipo === "uniforme" && itensUni === null) || ((tipo === "equipamento" || tipo === "epi") && itensEq === null);
  const local = lj?.cidade ? `${lj.cidade}${lj.uf ? `/${lj.uf}` : ""}` : "";
  const faltaPessoal = !f.completo;

  function gerar() {
    const dados: DadosTermo = {
      nome: c.nome_completo, cpf, cargo: c.cargo_nome ?? "", loja: lj?.nome ?? c.loja_nome ?? "", admissao: c.data_admissao ? dataBR(c.data_admissao) : "",
      rg: [f.rg, f.rg_orgao].filter(Boolean).join(" / "),
      endereco: [f.logradouro, f.numero, f.complemento, f.bairro].filter(Boolean).join(", "),
      cepCidade: [f.cep, [f.cidade, f.uf].filter(Boolean).join("/")].filter(Boolean).join(" · "),
      empresa: emp?.razao_social ?? "", cnpj: cnpjFmt(emp?.cnpj), local, dataTermo,
    };
    const html = tipo === "uniforme" ? termoUniforme(dados, tipoUni, itensUni ?? [], dataUni, renovUni)
      : tipo === "equipamento" ? termoEquipamento(dados, itensEq ?? [], outroEq)
      : tipo === "epi" ? termoEpi(dados, itensEpi ?? [])
      : termoImagem(dados);
    imprimir(html, `${TIPOS[tipo!].rotulo} - ${c.nome_completo}`);
  }

  return (
    <Modal aberto aoFechar={fechar} largura="max-w-3xl" titulo={tipo ? `Gerar termo · ${TIPOS[tipo].rotulo}` : "Gerar termo"}
      descricao={`${c.nome_completo} · ${c.cargo_nome ?? "sem cargo"} · ${c.loja_nome}`}>
      {!tipo ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(TIPOS) as TipoTermo[]).map((k) => { const T = TIPOS[k]; const I = T.icone; return (
            <button key={k} type="button" onClick={() => setTipo(k)}
              className="flex items-start gap-3 rounded-xl border border-borda p-4 text-left transition-colors hover:border-primaria hover:bg-primaria-suave">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primaria-suave text-primaria"><I className="size-5" aria-hidden /></span>
              <span><span className="block font-medium">{T.rotulo}</span><span className="text-sm text-texto-suave">{T.descricao}</span></span>
            </button>); })}
        </div>
      ) : carregando ? <Carregando /> : (
        <form onSubmit={(e) => { e.preventDefault(); gerar(); }} className="flex flex-col gap-4">
          <div className="rounded-lg bg-fundo p-3 text-sm">
            <p className="mb-1 text-xs font-medium uppercase text-texto-suave">Vem da ficha</p>
            <p>{c.nome_completo} · CPF {cpf || "—"} · {c.cargo_nome ?? "sem cargo"} · {c.loja_nome} · admissão {c.data_admissao ? dataBR(c.data_admissao) : "—"}</p>
            {tipo === "imagem" && <p className="mt-1">RG {[f.rg, f.rg_orgao].filter(Boolean).join(" / ") || "—"} · {[f.logradouro, f.numero, f.bairro, f.cidade].filter(Boolean).join(", ") || "endereço não cadastrado"} · Empresa {emp?.razao_social ?? "—"}</p>}
          </div>
          {faltaPessoal && <Aviso tom="alerta">Seu perfil não vê os dados pessoais (CPF, RG, endereço). Esses campos saem em branco para preencher à mão.</Aviso>}

          {tipo === "uniforme" && itensUni && (
            <>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">Tipo de entrega</legend>
                {[["onboarding", "Onboarding — 1ª camiseta (1º mês)"], ["kit_definitivo", "Kit definitivo — 3 camisetas (a partir do 2º mês)"],
                  ["kit_montagem", "Kit Montagem — 4 camisetas (cargo de Montador Óptico)"], ["renovacao", "Renovação / Reposição"]].map(([v, t]) => (
                  <label key={v} className={cx("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm", tipoUni === v ? "border-primaria bg-primaria-suave" : "border-borda")}>
                    <input type="radio" name="tipoUni" checked={tipoUni === v} onChange={() => setTipoUni(v)} className="accent-[var(--color-primaria)]" />{t}
                  </label>
                ))}
              </fieldset>
              <EditorLinhas titulo="Itens recebidos" linhas={itensUni} setLinhas={setItensUni}
                colunas={[["item", "Item", "flex-[3]"], ["tamanho", "Tamanho", "flex-1"], ["qtd", "Qtd.", "w-16"], ["estado", "Estado", "flex-1"]]}
                nova={{ item: "", tamanho: "", qtd: "1", estado: "NOVO" }} />
              <div className="grid grid-cols-2 gap-3">
                <Campo rotulo="Data desta entrega" type="date" value={dataUni} onChange={(e) => { setDataUni(e.target.value); if (e.target.value) setRenovUni(somaMeses(e.target.value, 8)); }} />
                <Campo rotulo="Próxima renovação (+8 meses)" type="date" value={renovUni} onChange={(e) => setRenovUni(e.target.value)} />
              </div>
            </>
          )}

          {tipo === "equipamento" && itensEq && (
            <>
              <EditorLinhas titulo="Equipamento(s) entregue(s)" linhas={itensEq} setLinhas={setItensEq}
                colunas={[["item", "Item / marca / modelo", "flex-[3]"], ["patrimonio", "Nº patrimônio / série", "flex-[2]"], ["qtd", "Qtd.", "w-16"],
                  ["acessorios", "Acessórios", "flex-[2]"], ["estado", "Estado", "flex-1"], ["data", "Data", "w-36", "date"]]}
                nova={{ item: "", patrimonio: "", qtd: "1", acessorios: "", estado: "BOM", data: hoje() }} />
              <Campo rotulo="Categoria “Outro” (se houver)" value={outroEq} onChange={(e) => setOutroEq(e.target.value)} placeholder="Ex.: máquina de cartão" />
              <p className="text-xs text-texto-suave">As categorias (notebook, celular, linha, tablet) são marcadas sozinhas pelos itens.</p>
            </>
          )}

          {tipo === "epi" && itensEpi && (
            <EditorLinhas titulo="EPI(s) entregue(s)" linhas={itensEpi} setLinhas={setItensEpi}
              colunas={[["epi", "EPI", "flex-[3]"], ["ca", "Nº do CA", "flex-1"], ["qtd", "Qtd.", "w-16"], ["data", "Data da entrega", "w-36", "date"], ["validade", "Validade / troca", "flex-1"]]}
              nova={{ epi: "", ca: "", qtd: "1", data: hoje(), validade: "" }} />
          )}

          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Local" value={local || "—"} disabled dica="Cidade da loja" />
            <Campo rotulo="Data do termo" type="date" value={dataTermo} onChange={(e) => setDataTermo(e.target.value)} />
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            {!tipoInicial ? <Botao type="button" variante="fantasma" onClick={() => setTipo(null)}>Trocar termo</Botao> : <span />}
            <div className="flex gap-2">
              <Botao type="button" variante="secundaria" onClick={fechar}>Cancelar</Botao>
              <Botao type="submit" icone={<Printer className="size-4" />}>Gerar e imprimir</Botao>
            </div>
          </div>
          <p className="text-xs text-texto-suave">Depois de assinado, anexe o termo em Documentos (ou no item da admissão) para ficar guardado na ficha.</p>
        </form>
      )}
    </Modal>
  );
}

function EditorLinhas({ titulo, linhas, setLinhas, colunas, nova }: {
  titulo: string; linhas: Linha[]; setLinhas: (l: Linha[]) => void;
  colunas: [string, string, string, string?][]; nova: Linha;
}) {
  const mudar = (i: number, k: string, v: string) => setLinhas(linhas.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{titulo}</p>
        <Botao type="button" tamanho="sm" variante="secundaria" icone={<Plus className="size-4" />} onClick={() => setLinhas([...linhas, { ...nova }])}>Linha</Botao>
      </div>
      <div className="overflow-x-auto rounded-lg border border-borda">
        <div className="flex min-w-[640px] gap-2 bg-fundo px-2 py-1.5 text-xs font-medium uppercase text-texto-suave">
          {colunas.map(([k, r, w]) => <span key={k} className={w}>{r}</span>)}<span className="w-8" />
        </div>
        {linhas.map((l, i) => (
          <div key={i} className="flex min-w-[640px] items-center gap-2 border-t border-borda px-2 py-1.5">
            {colunas.map(([k, r, w, t]) => (
              <input key={k} aria-label={r} type={t ?? "text"} value={l[k] ?? ""} onChange={(e) => mudar(i, k, e.target.value)}
                className={cx("h-9 min-w-0 rounded-md border border-borda bg-superficie px-2 text-sm", w)} />
            ))}
            <button type="button" aria-label="Remover linha" onClick={() => setLinhas(linhas.filter((_, j) => j !== i))}
              className="inline-flex size-8 items-center justify-center rounded-md text-texto-suave hover:bg-fundo hover:text-perigo"><Trash2 className="size-4" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modelos (mesmo visual dos .docx oficiais)                            */
/* ------------------------------------------------------------------ */
type DadosTermo = { nome: string; cpf: string; cargo: string; loja: string; admissao: string; rg: string; endereco: string; cepCidade: string;
  empresa: string; cnpj: string; local: string; dataTermo: string };

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
const up = (s: string) => esc(s.toUpperCase());
const dt = (iso?: string) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? dataBR(iso) : esc(iso ?? ""));
const marca = (b: boolean) => (b ? "(X)" : "(&nbsp;&nbsp;)");

const CSS = `@page{size:A4;margin:16mm 16mm 18mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;font-size:11.5px;line-height:1.45;margin:0}
.cab{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #0F9CA3;padding-bottom:8px;margin-bottom:16px}.cab img{height:42px}.cab span{font-size:10px;color:#6B7B7C;font-style:italic}
h1{font-size:20px;color:#0F9CA3;margin:6px 0 2px}.sub{color:#6B7B7C;font-style:italic;font-size:10.5px;margin:0 0 10px}
h2{font-size:13px;color:#0F9CA3;margin:16px 0 6px;padding-bottom:3px;border-bottom:1.5px solid #F2994A}
table{width:100%;border-collapse:collapse;margin:4px 0 6px}td,th{border:1px solid #B9C6C7;padding:5px 6px;vertical-align:top;text-align:left}
th{background:#0F9CA3;color:#fff;font-size:10.5px;text-align:center}td.r{background:#F3F7F7;color:#333;font-size:10.5px;width:16%;white-space:nowrap}
td.v{font-weight:bold}.vazio td{height:22px}ul{margin:4px 0 6px;padding-left:18px}li{margin:2px 0}.pequeno{font-size:9.5px;color:#6B7B7C;font-style:italic}
.ass td{height:54px;vertical-align:bottom;text-align:center;font-size:10px}.ass th{font-size:10.5px}.rod{position:fixed;bottom:-10mm;left:0;right:0;text-align:center;font-size:9px;color:#6B7B7C}
.duas{display:flex;gap:40px;margin-top:40px}.duas div{flex:1;border-top:1px solid #1a1a1a;padding-top:4px;font-size:10.5px}
@media screen{body{max-width:800px;margin:24px auto;padding:0 24px}}`;

/* logo embutido no próprio termo (a janela de impressão não depende de carregar arquivo) */
let logoDataUrl = "";
export async function carregarLogo() {
  if (logoDataUrl) return;
  try {
    const b = await (await fetch("/logo.png")).blob();
    logoDataUrl = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(b); });
  } catch { logoDataUrl = `${location.origin}/logo.png`; }
}

export function pagina(titulo: string, corpo: string, sub = "") {
  const logo = logoDataUrl || `${location.origin}/logo.png`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${CSS}</style></head><body>
<div class="cab"><img src="${logo}" alt="Óticas Idealize"><span>Termo Individual</span></div>
<h1>${esc(titulo)}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}${corpo}
<div class="rod">Óticas Idealize &nbsp;|&nbsp; Campinas &nbsp;|&nbsp; Sorocaba &nbsp;|&nbsp; São Vicente &nbsp;|&nbsp; Piracicaba</div>
<script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`;
}

const dadosColaborador = (d: DadosTermo) => `<h2>1. Dados do Colaborador</h2><table>
<tr><td class="r">Nome completo</td><td class="v" colspan="3">${up(d.nome)}</td><td class="r">CPF</td><td class="v" style="white-space:nowrap">${esc(d.cpf)}</td></tr>
<tr><td class="r">Cargo / Função</td><td class="v">${up(d.cargo)}</td><td class="r">Loja / Unidade</td><td class="v">${up(d.loja)}</td><td class="r">Data de admissão</td><td class="v">${esc(d.admissao)}</td></tr></table>`;

const assinaturas = (n: number, d: DadosTermo) => `<h2>${n}. Assinaturas</h2><table class="ass">
<tr><th>Local e data</th><th>Assinatura do colaborador</th><th>Assinatura do gestor da unidade</th></tr>
<tr><td>${esc(d.local)}${d.local ? ", " : ""}${dt(d.dataTermo)}</td><td></td><td></td></tr></table>`;

const tabela = (cab: string[], linhas: string[][], minimo: number) => {
  const vazias = Math.max(0, minimo - linhas.length);
  return `<table><tr>${cab.map((c) => `<th>${c}</th>`).join("")}</tr>${linhas.map((l) => `<tr>${l.map((v) => `<td>${v}</td>`).join("")}</tr>`).join("")}${
    Array.from({ length: vazias }, () => `<tr class="vazio">${cab.map(() => "<td></td>").join("")}</tr>`).join("")}</table>`;
};
const preenchidas = (ls: Linha[], chave: string) => ls.filter((l) => (l[chave] ?? "").trim());

function termoUniforme(d: DadosTermo, tipo: string, itens: Linha[], dataEntrega: string, renov: string) {
  const ls = preenchidas(itens, "item").map((l) => [up(l.item), up(l.tamanho ?? ""), esc(l.qtd ?? ""), up(l.estado ?? "")]);
  return pagina("Termo de Recebimento de Uniforme", `${dadosColaborador(d)}
<h2>2. Dados desta Entrega</h2><p>Assinale o tipo de entrega correspondente:</p><ul style="list-style:none;padding-left:4px">
<li>${marca(tipo === "onboarding")} Onboarding — 1ª camiseta (1º mês)</li><li>${marca(tipo === "kit_definitivo")} Kit definitivo — 3 camisetas (a partir do 2º mês)</li>
<li>${marca(tipo === "kit_montagem")} Kit Montagem — 4 camisetas (cargo de Montador Óptico)</li><li>${marca(tipo === "renovacao")} Renovação / Reposição</li></ul>
<p style="color:#0F9CA3;font-weight:bold;margin:8px 0 2px">Itens recebidos</p>${tabela(["Item", "Tamanho", "Quantidade", "Estado na Entrega"], ls, 6)}
<table><tr><th>Data desta entrega</th><th>Próxima renovação prevista (+8 meses)</th></tr><tr><td style="text-align:center">${dt(dataEntrega)}</td><td style="text-align:center">${dt(renov)}</td></tr></table>
<h2>3. Declaração de Recebimento e Responsabilidade</h2>
<p>Eu, colaborador(a) identificado(a) acima, declaro ter recebido gratuitamente da Óticas Idealize os itens de uniforme relacionados neste termo, em bom estado de conservação, para uso exclusivo durante o exercício das minhas funções. Ao assinar este termo, comprometo-me a:</p>
<ul><li>Manter o uniforme limpo e em boas condições de uso e conservação;</li><li>Utilizá-lo exclusivamente em atividades relacionadas ao trabalho;</li>
<li>Comunicar imediatamente à minha liderança direta qualquer dano, perda ou extravio;</li>
<li>Devolver as peças limpas e em bom estado no desligamento, na troca de função ou de unidade, na substituição ou quando solicitado pela empresa.</li></ul>
<p>Estou ciente de que o fornecimento do uniforme é gratuito, conforme a Política de Uniformes e o Regimento Interno (V2, itens 3.4 e 6), e que eventuais descontos em folha somente ocorrerão em casos de comprovado dano ou extravio por mau uso, respeitados os limites legais e o meu direito de defesa.</p>
${assinaturas(4, d)}`);
}

function termoEquipamento(d: DadosTermo, itens: Linha[], outro: string) {
  const ls = preenchidas(itens, "item");
  const tem = (re: RegExp) => ls.some((l) => re.test(l.item));
  const cat = `Categoria: ${marca(tem(/NOTEBOOK|LAPTOP/i))} Notebook &nbsp; ${marca(tem(/CELULAR|SMARTPHONE/i))} Celular &nbsp; ${marca(tem(/CHIP|LINHA/i))} Linha Telefônica &nbsp; ${marca(tem(/TABLET/i))} Tablet &nbsp; ${marca(!!outro.trim())} Outro: ${outro.trim() ? up(outro) : "____________"}`;
  const linhas = ls.map((l) => [up(l.item), up(l.patrimonio ?? ""), esc(l.qtd ?? ""), up(l.acessorios ?? ""), up(l.estado ?? ""), dt(l.data)]);
  return pagina("Termo de Recebimento de Equipamento", `${dadosColaborador(d)}
<h2>2. Equipamento(s) Entregue(s)</h2><p>${cat}</p>
${tabela(["Item / Marca / Modelo", "Nº Patrimônio / Série", "Qtd.", "Acessórios Inclusos", "Estado na Entrega", "Data"], linhas, 3)}
<p class="pequeno">Exemplos de item: notebook, celular corporativo, carregador, capa/case, chip/linha, mouse.</p>
<h2>3. Declaração de Recebimento e Responsabilidade</h2>
<p>Eu, colaborador(a) identificado(a) acima, declaro ter recebido, em bom estado de funcionamento e conservação (ressalvadas as observações registradas neste termo), o(s) equipamento(s) relacionado(s) acima, destinado(s) exclusivamente ao uso profissional nas atividades desempenhadas nas Óticas Idealize. Ao assinar este termo, comprometo-me a:</p>
<ul><li>Zelar pela guarda, conservação e uso adequado do(s) equipamento(s), adotando os cuidados necessários para evitar danos, perda, furto ou extravio;</li>
<li>Utilizá-lo(s) exclusivamente em atividades relacionadas ao trabalho;</li>
<li>Comunicar imediatamente ao meu gestor direto e/ou ao Departamento Pessoal qualquer dano, mau funcionamento, perda ou furto;</li>
<li>Devolver o(s) equipamento(s) em caso de desligamento, afastamento prolongado ou mudança de função que dispense o uso, no prazo de até 5 (cinco) dias úteis, salvo orientação diversa da empresa.</li></ul>
<p>Estou ciente de que o(s) equipamento(s) é(são) de propriedade das Óticas Idealize, que eventual apuração de responsabilidade e eventual ressarcimento seguirão a política interna da empresa e a legislação trabalhista vigente, e que este termo não autoriza, por si só, desconto em folha de pagamento.</p>
<h2>4. Registro de Devolução</h2>${tabela(["Data da Devolução", "Item(ns) Devolvido(s)", "Estado na Devolução", "Recebido por"], [], 2)}
${assinaturas(5, d)}`);
}

function termoEpi(d: DadosTermo, itens: Linha[]) {
  const linhas = preenchidas(itens, "epi").map((l) => [up(l.epi), up(l.ca ?? ""), esc(l.qtd ?? ""), dt(l.data), up(l.validade ?? "")]);
  return pagina("Ficha de Entrega e Termo de Responsabilidade de EPI", `${dadosColaborador(d)}
<h2>2. EPI(s) Entregue(s)</h2><p class="pequeno">Relacione na tabela abaixo todos os Equipamentos de Proteção Individual entregues ao colaborador. Utilize uma nova ficha sempre que houver entrega, reposição ou substituição de equipamento.</p>
${tabela(["EPI entregue", "Nº do CA", "Qtde.", "Data da entrega", "Validade / troca"], linhas, 4)}
<h2>3. Termo de Responsabilidade</h2>
<p>Pelo presente termo, declaro ter recebido, gratuitamente, os Equipamentos de Proteção Individual (EPI) relacionados acima, em perfeito estado de conservação e com Certificado de Aprovação (CA) válido, conforme a NR-6, e ter sido orientado e treinado pela Óticas Idealize sobre:</p>
<ul><li>O risco ocupacional ao qual estou exposto na função que exerço;</li><li>A forma correta de uso, ajuste e higienização de cada equipamento;</li>
<li>As responsabilidades e as consequências do uso inadequado ou da recusa em utilizá-lo.</li></ul>
<p>Comprometo-me a:</p>
<ul><li>Usar o EPI apenas para a finalidade a que se destina, durante toda a jornada de trabalho em que o risco estiver presente;</li>
<li>Guardar e conservar o equipamento de forma adequada;</li><li>Não alterar nem adaptar o equipamento;</li>
<li>Comunicar ao gestor da unidade, no mesmo dia, qualquer dano, extravio, perda de validade ou necessidade de higienização/substituição do equipamento;</li>
<li>Devolver o EPI à empresa na troca ou substituição, na mudança de função ou de unidade, no desligamento ou a pedido da empresa, exceto os itens descartáveis.</li></ul>
<p>Estou ciente de que a recusa injustificada no uso do EPI constitui falta grave (art. 158, parágrafo único, da CLT), conforme o item 4.6 do Regimento Interno e Código de Conduta (Versão 2.0), e está sujeita à Gestão de Consequências prevista na seção 11 do mesmo Regimento, podendo, conforme a gravidade e a reincidência, resultar em advertência, suspensão ou rescisão do contrato de trabalho por justa causa.</p>
${assinaturas(4, d)}`, "Classificação: Uso Interno · Versão 2.0");
}

function termoImagem(d: DadosTermo) {
  const local = d.local ? `${esc(d.local)}, ${porExtenso(d.dataTermo)}.` : `____________, ${porExtenso(d.dataTermo)}.`;
  return pagina("Termo de Autorização de Uso de Imagem e Voz", `
<h2>1. Identificação das Partes</h2><p style="font-weight:bold;margin:4px 0">COLABORADOR(A)</p><table>
<tr><td class="r">Nome completo</td><td class="v">${up(d.nome)}</td><td class="r">CPF</td><td class="v">${esc(d.cpf)}</td></tr>
<tr><td class="r">RG / Órgão</td><td class="v">${up(d.rg)}</td><td class="r">Cargo</td><td class="v">${up(d.cargo)}</td></tr>
<tr><td class="r">Endereço</td><td class="v">${up(d.endereco)}</td><td class="r">CEP / Cidade</td><td class="v">${up(d.cepCidade)}</td></tr></table>
<p style="font-weight:bold;margin:8px 0 4px">EMPRESA</p><table>
<tr><td class="r">Razão social</td><td class="v">${up(d.empresa)}</td></tr><tr><td class="r">CNPJ</td><td class="v">${esc(d.cnpj)}</td></tr>
<tr><td class="r">Unidade</td><td class="v">${esc(d.loja)}</td></tr></table>
<h2>2. O que está sendo autorizado</h2><p>O(A) <b>COLABORADOR(A)</b> autoriza a <b>EMPRESA</b> a usar, de forma gratuita, sua imagem e sua voz captadas em fotografias, vídeos e gravações de áudio, sozinho(a) ou com outras pessoas, incluindo edição, corte e montagem do material.</p>
<h2>3. Onde e para que pode ser usado</h2><p>O uso é permitido para comunicação interna, treinamentos, divulgação institucional e marketing da marca Óticas Idealize, nos seguintes meios:</p>
<ul><li><b>Internos:</b> grupos, murais, apresentações e treinamentos; <b>Digitais:</b> redes sociais, site, e-mail, WhatsApp e anúncios on-line;</li>
<li><b>Físicos:</b> folhetos, banners, vitrines, materiais de loja e outdoors; <b>Outros:</b> eventos, TV e rádio.</li></ul>
<p>Como a internet tem alcance mundial, o uso pode ocorrer em âmbito nacional e internacional.</p>
<h2>4. O que não é permitido</h2><p>A imagem e a voz não podem ser usadas para fins ilícitos nem de forma que constranja, ridicularize ou prejudique a honra, a reputação ou a dignidade do(a) <b>COLABORADOR(A)</b>. Também não podem ser usadas por terceiros para fins sem relação com a Óticas Idealize.</p>
<h2>5. Gratuidade e participação voluntária</h2><p>Esta autorização é gratuita: não gera pagamento, indenização ou qualquer acréscimo ao salário. A assinatura é <b>voluntária</b> e não é condição para a contratação nem para a permanência no emprego.</p>
<h2>6. Prazo e revogação</h2><p>A autorização vale por prazo indeterminado, inclusive após o desligamento. O(A) <b>COLABORADOR(A)</b> pode revogá-la a qualquer momento, <b>por escrito</b>, entregando o pedido ao RH. Após o recebimento:</p>
<ul><li>a <b>EMPRESA</b> não produzirá novos materiais com sua imagem ou voz;</li><li>em até 30 dias, retirará de circulação os anúncios e materiais ainda em veiculação sob seu controle;</li>
<li>publicações e materiais feitos antes da revogação não precisam ser apagados ou recolhidos.</li></ul>
<h2>7. Proteção de dados (LGPD)</h2><p>A imagem e a voz são dados pessoais e serão tratadas conforme a Lei nº 13.709/2018, apenas para as finalidades deste termo e com medidas de segurança adequadas. O(A) <b>COLABORADOR(A)</b> pode pedir informações sobre o uso dos seus dados ao RH a qualquer momento.</p>
<h2>8. Declaração e assinaturas</h2><p>Declaro que li e entendi este termo e que concordo com ele. Este documento é assinado em 2 (duas) vias de igual teor, uma para cada parte.</p>
<p style="text-align:right;margin-top:10px">${local}</p>
<div class="duas"><div><b>COLABORADOR(A)</b><br>Nome: ${up(d.nome)}<br>CPF: ${esc(d.cpf)}</div><div><b>EMPRESA</b><br>${up(d.empresa)}<br>CNPJ: ${esc(d.cnpj)}</div></div>`,
  "Lei nº 9.610/1998 (Direitos Autorais) &nbsp;|&nbsp; Lei nº 13.709/2018 (LGPD)");
}

export function imprimir(html: string, titulo: string) {
  const w = window.open("", "_blank");
  if (!w) { alert("Libere as janelas pop-up deste site para gerar o termo."); return; }
  w.document.open(); w.document.write(html); w.document.title = titulo; w.document.close();
}
