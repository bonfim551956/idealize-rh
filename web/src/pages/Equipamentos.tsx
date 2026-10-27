import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, FileCheck2, FileUp, Laptop, PackagePlus, Plus, Printer, Trash2, Undo2 } from "lucide-react";
import { chamarFuncao, mensagemErro, supabase } from "../lib/supabase";
import { falhar, useCategorias, type ColaboradorLinha } from "../lib/dados";
import { data, hoje } from "../lib/formato";
import { useAuth } from "../auth/AuthProvider";
import { AreaTexto, Aviso, Botao, Campo, Cartao, Carregando, EstadoErro, Modal, Selecao, Selo, cx, useAvisos } from "../ui/componentes";

type Equipamento = {
  id: string; colaborador_id: string; tipo: string; descricao: string | null; identificacao: string | null; quantidade: number;
  data_entrega: string; observacao: string | null; documento_id: string | null;
  devolvido_em: string | null; devolucao_estado: "bom" | "danificado" | "extraviado" | null; devolucao_observacao: string | null;
  cancelado: boolean; cancelado_motivo: string | null; registrado_em: string;
};
type ItemForm = { tipo: string; descricao: string; identificacao: string; quantidade: string };

const SUGESTOES = ["CELULAR", "CHIP / LINHA", "NOTEBOOK", "TABLET", "MÁQUINA DE CARTÃO", "CRACHÁ", "CHAVE", "FONE / HEADSET", "CARREGADOR", "MOUSE", "TECLADO", "MONITOR", "FERRAMENTA"];
const ESTADO = { bom: { rotulo: "Devolvido em bom estado", tom: "sucesso" }, danificado: { rotulo: "Devolvido danificado", tom: "alerta" }, extraviado: { rotulo: "Extraviado", tom: "perigo" } } as const;
const nomeEquip = (e: Pick<Equipamento, "tipo" | "descricao">) => `${e.tipo}${e.descricao ? ` · ${e.descricao}` : ""}`;

function useTermoCategoria() {
  const cats = useCategorias();
  return cats.data?.find((c) => c.codigo === "termo_equipamento");
}

async function enviarTermo(arquivo: File, colaborador: ColaboradorLinha, categoriaId: string, dataEntrega: string): Promise<string> {
  const fd = new FormData();
  fd.append("arquivo", arquivo);
  fd.append("meta", JSON.stringify({
    categoria_id: categoriaId, colaborador_id: colaborador.id,
    nome: "TERMO DE RESPONSABILIDADE - EQUIPAMENTOS", data_emissao: dataEntrega || null,
  }));
  const r = await chamarFuncao<{ documento_id: string }>("documentos-upload", fd, false);
  return r.documento_id;
}

async function abrirTermo(documentoId: string, avisar: ReturnType<typeof useAvisos>) {
  const janela = window.open("", "_blank");
  try {
    const r = await chamarFuncao<{ url: string }>("documentos-acesso", JSON.stringify({ documento_id: documentoId, acao: "visualizar" }));
    if (janela) { janela.opener = null; janela.location.href = r.url; } else window.location.href = r.url;
  } catch (e) { janela?.close(); avisar("erro", mensagemErro(e)); }
}

/* Termo pronto para imprimir e assinar (o assinado é anexado depois) */
function imprimirTermo(c: ColaboradorLinha, itens: { tipo: string; descricao?: string | null; identificacao?: string | null; quantidade: number | string }[], dataEntrega: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
  const linhas = itens.map((i) => `<tr><td>${esc(String(i.quantidade || 1))}</td><td>${esc(i.tipo.toUpperCase())}</td><td>${esc((i.descricao ?? "").toUpperCase())}</td><td>${esc((i.identificacao ?? "").toUpperCase())}</td></tr>`).join("");
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Termo de responsabilidade</title>
<style>body{font-family:Arial,sans-serif;color:#1a1a1a;margin:40px;line-height:1.5;font-size:14px}h1{font-size:18px;text-align:center;margin-bottom:24px}
table{width:100%;border-collapse:collapse;margin:16px 0}td,th{border:1px solid #444;padding:6px 8px;text-align:left;font-size:13px}
.ass{margin-top:64px;display:flex;justify-content:space-between;gap:48px}.ass div{flex:1;border-top:1px solid #1a1a1a;padding-top:4px;text-align:center;font-size:12px}</style></head><body>
<h1>TERMO DE RESPONSABILIDADE PELA GUARDA E USO DE EQUIPAMENTOS</h1>
<p>Eu, <b>${esc(c.nome_completo)}</b>, CPF ${esc(c.cpf_mascarado)}, colaborador(a) da unidade <b>${esc(c.loja_nome)}</b>, declaro ter recebido em <b>${new Date(`${dataEntrega}T12:00:00`).toLocaleDateString("pt-BR")}</b>, para uso exclusivo no trabalho, os equipamentos abaixo, em perfeito estado de conservação e funcionamento:</p>
<table><thead><tr><th>Qtd.</th><th>Equipamento</th><th>Marca / modelo</th><th>Identificação (patrimônio, série, IMEI, linha)</th></tr></thead><tbody>${linhas}</tbody></table>
<p>Comprometo-me a zelar pela guarda e conservação dos equipamentos, utilizá-los apenas para fins profissionais, comunicar imediatamente qualquer defeito, perda, furto ou roubo, e devolvê-los quando solicitado ou no desligamento, no estado em que os recebi, ressalvado o desgaste natural de uso.</p>
<p>Estou ciente de que, em caso de dano causado por dolo ou de dano causado por culpa, nos termos do art. 462, § 1º, da CLT, o valor correspondente poderá ser descontado, conforme a legislação vigente.</p>
<div class="ass"><div>${esc(c.nome_completo)}<br>Colaborador(a)</div><div>Responsável pela entrega<br>Óticas Idealize</div></div>
<p style="margin-top:32px;font-size:12px">Local e data: ____________________________, ____/____/________</p>
<script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

/* ---------------- Aba da ficha ---------------- */
export function EquipamentosColaborador({ c }: { c: ColaboradorLinha }) {
  const { pode } = useAuth();
  const avisar = useAvisos();
  const gere = pode("equipamento.gerir", c.loja_atual_id);
  const [novo, setNovo] = useState(false);
  const [devolver, setDevolver] = useState<Equipamento | null>(null);
  const [cancelar, setCancelar] = useState<Equipamento | null>(null);
  const [anexar, setAnexar] = useState(false);
  const q = useQuery({
    queryKey: ["equipamentos", c.id],
    queryFn: async () => falhar(await supabase.from("equipamentos").select("*").eq("colaborador_id", c.id)
      .order("data_entrega", { ascending: false }).order("registrado_em", { ascending: false })) as Equipamento[],
  });
  const lista = q.data ?? [];
  const comEle = lista.filter((e) => !e.cancelado && !e.devolvido_em);
  const historico = lista.filter((e) => e.cancelado || e.devolvido_em);
  const semTermo = comEle.filter((e) => !e.documento_id);
  const encerrado = c.status === "desligado" || c.status === "arquivado";

  return (
    <div className="flex flex-col gap-6">
      <Cartao titulo={<span className="flex items-center gap-2"><Laptop className="size-4" /> Sob responsabilidade agora{comEle.length ? ` (${comEle.length})` : ""}</span>}
        acao={gere && <div className="flex flex-wrap gap-2">
          {semTermo.length > 0 && <Botao tamanho="sm" variante="secundaria" icone={<FileUp className="size-4" />} onClick={() => setAnexar(true)}>Anexar termo</Botao>}
          {!encerrado && <Botao tamanho="sm" icone={<PackagePlus className="size-4" />} onClick={() => setNovo(true)}>Entregar equipamentos</Botao>}
        </div>}>
        {q.isLoading && <Carregando />}
        {q.error && <EstadoErro mensagem={(q.error as Error).message} tentarNovamente={() => q.refetch()} />}
        {q.data && comEle.length === 0 && <p className="text-sm text-texto-suave">Nenhum equipamento sob responsabilidade deste colaborador.</p>}
        {comEle.length > 0 && (
          <ul className="divide-y divide-borda">
            {comEle.map((e) => (
              <li key={e.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium">{e.quantidade > 1 && <span className="tabular-nums">{e.quantidade}× </span>}{nomeEquip(e)}</p>
                  {e.identificacao && <p className="text-xs text-texto-suave">{e.identificacao}</p>}
                  <p className="text-xs text-texto-suave">Entregue em {data(e.data_entrega)}{e.observacao ? ` · ${e.observacao}` : ""}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {e.documento_id
                    ? <Botao tamanho="sm" variante="fantasma" icone={<FileCheck2 className="size-4" />} onClick={() => abrirTermo(e.documento_id!, avisar)}>Ver termo</Botao>
                    : <Selo tom="alerta">Sem termo</Selo>}
                  {gere && <>
                    <Botao tamanho="sm" variante="secundaria" icone={<Undo2 className="size-4" />} onClick={() => setDevolver(e)}>Devolução</Botao>
                    <button className="rounded-lg p-2 text-texto-suave hover:bg-perigo-suave hover:text-perigo" aria-label="Cancelar lançamento" title="Cancelar lançamento" onClick={() => setCancelar(e)}><Ban className="size-4" /></button>
                  </>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {comEle.length > 0 && (
          <div className="mt-3 flex justify-end">
            <Botao tamanho="sm" variante="fantasma" icone={<Printer className="size-4" />}
              onClick={() => imprimirTermo(c, comEle, comEle[comEle.length - 1].data_entrega)}>Imprimir termo com tudo o que está com ele</Botao>
          </div>
        )}
        {encerrado && comEle.length > 0 && <div className="mt-3"><Aviso tom="alerta">Colaborador desligado com equipamentos sob responsabilidade. Registre a devolução.</Aviso></div>}
      </Cartao>

      {historico.length > 0 && (
        <Cartao titulo="Histórico">
          <ul className="divide-y divide-borda">
            {historico.map((e) => (
              <li key={e.id} className={cx("flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-start sm:justify-between", e.cancelado && "opacity-60")}>
                <div>
                  <p className="font-medium">{e.quantidade > 1 && `${e.quantidade}× `}{nomeEquip(e)}</p>
                  <p className="text-xs text-texto-suave">Entregue em {data(e.data_entrega)}{e.devolvido_em ? ` · devolvido em ${data(e.devolvido_em)}` : ""}</p>
                  {e.devolucao_observacao && <p className="text-xs text-texto-suave">{e.devolucao_observacao}</p>}
                  {e.cancelado && <p className="text-xs text-perigo">Lançamento cancelado: {e.cancelado_motivo}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {e.devolucao_estado && <Selo tom={ESTADO[e.devolucao_estado].tom}>{ESTADO[e.devolucao_estado].rotulo}</Selo>}
                  {e.documento_id && <Botao tamanho="sm" variante="fantasma" icone={<FileCheck2 className="size-4" />} onClick={() => abrirTermo(e.documento_id!, avisar)}>Termo</Botao>}
                </div>
              </li>
            ))}
          </ul>
        </Cartao>
      )}

      {novo && <EntregarModal c={c} fechar={() => setNovo(false)} />}
      {anexar && <AnexarTermoModal c={c} itens={semTermo} fechar={() => setAnexar(false)} />}
      {devolver && <DevolverModal e={devolver} fechar={() => setDevolver(null)} />}
      {cancelar && <CancelarModal e={cancelar} fechar={() => setCancelar(null)} />}
    </div>
  );
}

/* ---------------- Modais ---------------- */
function EntregarModal({ c, fechar }: { c: ColaboradorLinha; fechar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAvisos();
  const termoCat = useTermoCategoria();
  const [dataEntrega, setDataEntrega] = useState(hoje());
  const [itens, setItens] = useState<ItemForm[]>([{ tipo: "", descricao: "", identificacao: "", quantidade: "1" }]);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [obs, setObs] = useState("");
  const validos = itens.filter((i) => i.tipo.trim().length >= 2);
  const m = useMutation({
    mutationFn: async () => {
      let documento: string | null = null;
      if (arquivo) {
        if (!termoCat) throw new Error("Categoria de termo não encontrada. Recarregue a página.");
        documento = await enviarTermo(arquivo, c, termoCat.id, dataEntrega);
      }
      const { error } = await supabase.rpc("equipamento_entregar", {
        p_colaborador: c.id, p_data: dataEntrega,
        p_itens: validos.map((i) => ({ tipo: i.tipo, descricao: i.descricao, identificacao: i.identificacao, quantidade: Number(i.quantidade) || 1 })),
        p_documento: documento, p_observacao: obs || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      ["equipamentos", "documentos", "timeline"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      avisar("sucesso", arquivo ? "Entrega registrada com o termo." : "Entrega registrada. Anexe o termo assinado assim que possível.");
      fechar();
    },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  const mudar = (n: number, p: Partial<ItemForm>) => setItens((l) => l.map((x, i) => (i === n ? { ...x, ...p } : x)));

  return (
    <Modal aberto aoFechar={fechar} largura="max-w-2xl" titulo="Entregar equipamentos" descricao={c.nome_completo}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        <Campo rotulo="Data da entrega" type="date" obrigatorio value={dataEntrega} max={hoje()} onChange={(e) => setDataEntrega(e.target.value)} className="sm:w-56" />
        <datalist id="sugestoes-equipamento">{SUGESTOES.map((s) => <option key={s} value={s} />)}</datalist>
        <div className="flex flex-col gap-3">
          {itens.map((i, n) => (
            <div key={n} className="grid gap-2 rounded-lg border border-borda p-3 sm:grid-cols-[1.2fr_1.2fr_1.4fr_80px_auto] sm:items-end">
              <Campo rotulo="Equipamento" list="sugestoes-equipamento" value={i.tipo} onChange={(e) => mudar(n, { tipo: e.target.value })} obrigatorio={n === 0} />
              <Campo rotulo="Marca / modelo" value={i.descricao} onChange={(e) => mudar(n, { descricao: e.target.value })} />
              <Campo rotulo="Patrimônio / série / IMEI" value={i.identificacao} onChange={(e) => mudar(n, { identificacao: e.target.value })} />
              <Campo rotulo="Qtd." type="number" min={1} max={999} value={i.quantidade} onChange={(e) => mudar(n, { quantidade: e.target.value })} />
              {itens.length > 1
                ? <button type="button" className="h-10 rounded-lg px-2 text-texto-suave hover:bg-perigo-suave hover:text-perigo" aria-label="Remover item" onClick={() => setItens((l) => l.filter((_, k) => k !== n))}><Trash2 className="size-4" /></button>
                : <span />}
            </div>
          ))}
          <Botao type="button" tamanho="sm" variante="fantasma" icone={<Plus className="size-4" />} className="self-start"
            onClick={() => setItens((l) => [...l, { tipo: "", descricao: "", identificacao: "", quantidade: "1" }])}>Adicionar outro equipamento</Botao>
        </div>
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-borda p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Termo de responsabilidade assinado</p>
            <Botao type="button" tamanho="sm" variante="secundaria" icone={<Printer className="size-4" />} disabled={!validos.length}
              onClick={() => imprimirTermo(c, validos, dataEntrega)}>Imprimir termo para assinar</Botao>
          </div>
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" aria-label="Arquivo do termo assinado"
            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            className="text-sm file:mr-3 file:rounded-lg file:border file:border-borda file:bg-superficie file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-fundo" />
          <p className="text-xs text-texto-suave">PDF ou foto (JPG, PNG). Opcional agora: dá para anexar depois. O termo vai também para os Documentos do colaborador.</p>
        </div>
        <AreaTexto rotulo="Observação" value={obs} onChange={(e) => setObs(e.target.value)} rows={2} />
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundaria" onClick={fechar}>Cancelar</Botao>
          <Botao type="submit" carregando={m.isPending} disabled={!validos.length || !dataEntrega}>Registrar entrega</Botao>
        </div>
      </form>
    </Modal>
  );
}

function AnexarTermoModal({ c, itens, fechar }: { c: ColaboradorLinha; itens: Equipamento[]; fechar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAvisos();
  const termoCat = useTermoCategoria();
  const [marcados, setMarcados] = useState<string[]>(itens.map((i) => i.id));
  const [arquivo, setArquivo] = useState<File | null>(null);
  const m = useMutation({
    mutationFn: async () => {
      if (!arquivo || !termoCat) throw new Error("Escolha o arquivo do termo.");
      const primeiro = itens.find((i) => marcados.includes(i.id));
      const documento = await enviarTermo(arquivo, c, termoCat.id, primeiro?.data_entrega ?? hoje());
      const { error } = await supabase.rpc("equipamento_anexar_termo", { p_ids: marcados, p_documento: documento });
      if (error) throw error;
    },
    onSuccess: () => { ["equipamentos", "documentos"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); avisar("sucesso", "Termo anexado."); fechar(); },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  return (
    <Modal aberto aoFechar={fechar} titulo="Anexar termo assinado" descricao="Marque os equipamentos que constam no termo.">
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2">
          {itens.map((i) => (
            <li key={i.id}>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 size-4 accent-primaria" checked={marcados.includes(i.id)}
                  onChange={(e) => setMarcados((l) => e.target.checked ? [...l, i.id] : l.filter((x) => x !== i.id))} />
                <span>{nomeEquip(i)}<span className="block text-xs text-texto-suave">Entregue em {data(i.data_entrega)}{i.identificacao ? ` · ${i.identificacao}` : ""}</span></span>
              </label>
            </li>
          ))}
        </ul>
        <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" aria-label="Arquivo do termo assinado"
          onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
          className="text-sm file:mr-3 file:rounded-lg file:border file:border-borda file:bg-superficie file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-fundo" />
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundaria" onClick={fechar}>Cancelar</Botao>
          <Botao type="submit" icone={<FileUp className="size-4" />} carregando={m.isPending} disabled={!arquivo || !marcados.length}>Anexar</Botao>
        </div>
      </form>
    </Modal>
  );
}

function DevolverModal({ e, fechar }: { e: Equipamento; fechar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAvisos();
  const [f, setF] = useState({ data: hoje(), estado: "bom", obs: "" });
  const m = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("equipamento_devolver", { p_id: e.id, p_data: f.data, p_estado: f.estado, p_observacao: f.obs || null });
      if (error) throw error;
    },
    onSuccess: () => { ["equipamentos", "timeline"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); avisar("sucesso", "Devolução registrada."); fechar(); },
    onError: (err) => avisar("erro", mensagemErro(err)),
  });
  return (
    <Modal aberto aoFechar={fechar} titulo="Registrar devolução" descricao={nomeEquip(e)}>
      <form onSubmit={(ev: FormEvent) => { ev.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Data da devolução" type="date" obrigatorio value={f.data} min={e.data_entrega} max={hoje()} onChange={(ev) => setF({ ...f, data: ev.target.value })} />
          <Selecao rotulo="Estado" obrigatorio value={f.estado} onChange={(ev) => setF({ ...f, estado: ev.target.value })}>
            <option value="bom">Bom estado</option>
            <option value="danificado">Danificado</option>
            <option value="extraviado">Extraviado (não devolvido)</option>
          </Selecao>
        </div>
        <AreaTexto rotulo={f.estado === "bom" ? "Observação" : "O que aconteceu"} obrigatorio={f.estado !== "bom"} value={f.obs} onChange={(ev) => setF({ ...f, obs: ev.target.value })} rows={2} />
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundaria" onClick={fechar}>Cancelar</Botao>
          <Botao type="submit" carregando={m.isPending} disabled={f.estado !== "bom" && f.obs.trim().length < 3}>Registrar</Botao>
        </div>
      </form>
    </Modal>
  );
}

function CancelarModal({ e, fechar }: { e: Equipamento; fechar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAvisos();
  const [motivo, setMotivo] = useState("");
  const m = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc("equipamento_cancelar", { p_id: e.id, p_motivo: motivo }); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["equipamentos"] }); avisar("sucesso", "Lançamento cancelado."); fechar(); },
    onError: (err) => avisar("erro", mensagemErro(err)),
  });
  return (
    <Modal aberto aoFechar={fechar} titulo="Cancelar lançamento" descricao={`${nomeEquip(e)} · use só para lançamento errado. Para devolução, use “Devolução”.`}>
      <form onSubmit={(ev: FormEvent) => { ev.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        <AreaTexto rotulo="Motivo" obrigatorio value={motivo} onChange={(ev) => setMotivo(ev.target.value)} rows={2} />
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundaria" onClick={fechar}>Voltar</Botao>
          <Botao type="submit" variante="perigo" carregando={m.isPending} disabled={motivo.trim().length < 3}>Cancelar lançamento</Botao>
        </div>
      </form>
    </Modal>
  );
}
