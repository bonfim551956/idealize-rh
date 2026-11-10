import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, CheckCircle2, CircleDashed, CreditCard, FileSignature, HardHat, IdCard, Printer, Shirt, Undo2, Upload, type LucideIcon } from "lucide-react";
import { chamarFuncao, mensagemErro, supabase } from "../lib/supabase";
import { data, hoje } from "../lib/formato";
import { useCategorias, type ColaboradorLinha } from "../lib/dados";
import { useAuth } from "../auth/AuthProvider";
import { AreaTexto, Botao, Campo, Cartao, Carregando, EstadoErro, Modal, Selo, useAvisos } from "../ui/componentes";

/* Itens obrigatórios de toda admissão */
export type ItemChecklist = {
  item: "cartao_vr" | "uniforme" | "cracha" | "termo_imagem" | "equipamento_epi";
  concluido: boolean; data: string | null; por: string | null; detalhe: string | null;
  origem: "manual" | "uniformes" | "equipamentos" | "documento" | null; registro_id: string | null;
};

const ITENS: Record<ItemChecklist["item"], { rotulo: string; icone: LucideIcon; como: string }> = {
  cartao_vr:       { rotulo: "Entrega do cartão VR", icone: CreditCard, como: "Registre a data em que o cartão foi entregue." },
  uniforme:        { rotulo: "Entrega de uniforme", icone: Shirt, como: "Conclui sozinho quando a entrega é lançada na aba Uniformes." },
  cracha:          { rotulo: "Entrega de crachá", icone: IdCard, como: "Registre a data da entrega (ou lance o crachá na aba Equipamentos)." },
  termo_imagem:    { rotulo: "Termo de uso de imagem", icone: FileSignature, como: "Imprima o termo padrão, colha a assinatura e anexe o termo assinado." },
  equipamento_epi: { rotulo: "Entrega de equipamento / EPI", icone: HardHat, como: "Tem EPI ou equipamento para entregar? Se tiver, lance a entrega na aba Equipamentos. Se a função não usa, marque “Não tem”." },
};
export const ITENS_ADMISSAO = ["cartao_vr", "uniforme", "cracha", "termo_imagem", "equipamento_epi"] as const;

export function useChecklistAdmissao(colaboradorId: string | undefined) {
  return useQuery({
    queryKey: ["admissao-checklist", colaboradorId],
    enabled: !!colaboradorId,
    queryFn: async () => {
      const { data: r, error } = await supabase.rpc("admissao_checklist", { p_colaborador: colaboradorId });
      if (error) throw new Error(error.message);
      return r as ItemChecklist[];
    },
  });
}

/* Termo padrão para imprimir e assinar */
function imprimirTermoImagem(c: ColaboradorLinha) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
  const w = window.open("", "_blank");
  if (!w) return;
  const hojeTxt = new Date().toLocaleDateString("pt-BR");
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Termo de autorização de uso de imagem</title>
<style>body{font-family:Arial,sans-serif;color:#1a1a1a;margin:40px;line-height:1.5;font-size:14px}h1{font-size:18px;text-align:center;margin-bottom:24px}
ol{padding-left:20px}li{margin-bottom:6px}.ass{margin-top:64px;display:flex;justify-content:space-between;gap:48px}.ass div{flex:1;border-top:1px solid #1a1a1a;padding-top:4px;text-align:center;font-size:12px}</style></head><body>
<h1>TERMO DE AUTORIZAÇÃO DE USO DE IMAGEM E VOZ</h1>
<p>Eu, <b>${esc(c.nome_completo)}</b>, CPF ${esc(c.cpf_mascarado)}, colaborador(a) da unidade <b>${esc(c.loja_nome)}</b>, AUTORIZO, de forma gratuita, o uso da minha imagem, voz e nome pelas ÓTICAS IDEALIZE e empresas do grupo, nas seguintes condições:</p>
<ol>
<li>Uso em fotos, vídeos e gravações feitos no ambiente de trabalho, em treinamentos, eventos e ações da empresa.</li>
<li>Divulgação em redes sociais, site, aplicativos de mensagem, materiais impressos, comunicação interna e campanhas institucionais e publicitárias da empresa.</li>
<li>A autorização vale durante o contrato de trabalho e pelo prazo de 2 (dois) anos após o seu término para os materiais já produzidos, sem obrigação de retirada de conteúdo já publicado nesse período.</li>
<li>A imagem não será usada de forma que prejudique a minha honra, reputação ou dignidade, nem para fins diferentes dos aqui descritos.</li>
<li>Os dados serão tratados conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018). Posso revogar esta autorização a qualquer momento, por escrito, sem efeito sobre o uso já realizado.</li>
</ol>
<p>Declaro que li e concordo com os termos acima.</p>
<p style="margin-top:32px">________________________, ${esc(hojeTxt)}</p>
<div class="ass"><div>${esc(c.nome_completo)}<br>Colaborador(a)</div><div>ÓTICAS IDEALIZE<br>Empresa</div></div>
<script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

const TITULO_REGISTRO = { cartao_vr: "Entrega do cartão VR", cracha: "Entrega de crachá", epi_nao_tem: "Não tem EPI / equipamento para entregar" };

function RegistrarEntrega({ c, item, fechar }: { c: ColaboradorLinha; item: "cartao_vr" | "cracha" | "epi_nao_tem"; fechar: () => void }) {
  const semEpi = item === "epi_nao_tem";
  const qc = useQueryClient(); const avisar = useAvisos();
  const [dt, setDt] = useState(hoje()); const [obs, setObs] = useState("");
  const m = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("admissao_registrar_item", { p_colaborador: c.id, p_item: item, p_data: dt, p_observacao: obs || null });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admissao-checklist"] }); qc.invalidateQueries({ queryKey: ["painel-pendencias"] }); avisar("sucesso", semEpi ? "Registrado: não tem EPI para entregar." : "Entrega registrada."); fechar(); },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  return (
    <Modal aberto aoFechar={fechar} titulo={TITULO_REGISTRO[item]} descricao={c.nome_completo}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        {semEpi && <p className="text-sm text-texto-suave">Use quando a função desta pessoa não usa EPI nem equipamento. Se depois houver entrega, é só lançar na aba Equipamentos.</p>}
        <Campo rotulo={semEpi ? "Data" : "Data da entrega"} type="date" obrigatorio value={dt} onChange={(e) => setDt(e.target.value)} max={hoje()} />
        <AreaTexto rotulo="Observação" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} placeholder={semEpi ? "Opcional. Ex.: função de vendas não usa EPI" : "Opcional"} />
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundaria" onClick={fechar}>Cancelar</Botao>
          <Botao type="submit" carregando={m.isPending} disabled={!dt}>Salvar</Botao>
        </div>
      </form>
    </Modal>
  );
}

function Desfazer({ id, rotulo, fechar }: { id: string; rotulo: string; fechar: () => void }) {
  const qc = useQueryClient(); const avisar = useAvisos();
  const [motivo, setMotivo] = useState("");
  const m = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc("admissao_cancelar_item", { p_id: id, p_motivo: motivo }); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admissao-checklist"] }); qc.invalidateQueries({ queryKey: ["painel-pendencias"] }); avisar("sucesso", "Registro desfeito."); fechar(); },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  return (
    <Modal aberto aoFechar={fechar} titulo="Desfazer registro" descricao={rotulo}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        <AreaTexto rotulo="Motivo" obrigatorio rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: data lançada errada" />
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundaria" onClick={fechar}>Cancelar</Botao>
          <Botao type="submit" carregando={m.isPending} disabled={motivo.trim().length < 3}>Desfazer</Botao>
        </div>
      </form>
    </Modal>
  );
}

export function ChecklistAdmissao({ c, irPara }: { c: ColaboradorLinha; irPara: (aba: string) => void }) {
  const { pode } = useAuth();
  const qc = useQueryClient(); const avisar = useAvisos();
  const categorias = useCategorias();
  const [registrando, setRegistrando] = useState<"cartao_vr" | "cracha" | "epi_nao_tem" | null>(null);
  const [desfazendo, setDesfazendo] = useState<ItemChecklist | null>(null);
  const [enviando, setEnviando] = useState(false);
  const q = useChecklistAdmissao(c.id);
  if (q.isLoading) return <Carregando />;
  if (q.error) return <EstadoErro mensagem={(q.error as Error).message} tentarNovamente={() => q.refetch()} />;
  const mapa = new Map(q.data!.map((i) => [i.item, i]));
  const feitos = ITENS_ADMISSAO.filter((k) => mapa.get(k)?.concluido).length;
  const loja = c.loja_atual_id;
  const podeEntregar = pode("equipamento.gerir", loja);
  const catTermo = categorias.data?.find((k) => k.codigo === "termo_uso_imagem");
  const podeAnexar = !!catTermo && pode("documento.geral.enviar", loja);

  async function anexarTermo(arquivo: File | undefined) {
    if (!arquivo || !catTermo) return;
    setEnviando(true);
    try {
      const fd = new FormData();
      fd.append("arquivo", arquivo);
      fd.append("meta", JSON.stringify({ categoria_id: catTermo.id, colaborador_id: c.id, nome: "TERMO DE USO DE IMAGEM", data_emissao: hoje() }));
      await chamarFuncao("documentos-upload", fd, false);
      qc.invalidateQueries({ queryKey: ["admissao-checklist"] }); qc.invalidateQueries({ queryKey: ["documentos"] }); qc.invalidateQueries({ queryKey: ["painel-pendencias"] });
      avisar("sucesso", "Termo anexado aos documentos.");
    } catch (e) { avisar("erro", mensagemErro(e)); } finally { setEnviando(false); }
  }

  return (
    <Cartao titulo={<span className="inline-flex items-center gap-2"><BadgeCheck className="size-4 text-texto-suave" aria-hidden />Itens obrigatórios da admissão</span>}
      acao={<Selo tom={feitos === ITENS_ADMISSAO.length ? "sucesso" : "alerta"}>{feitos} de {ITENS_ADMISSAO.length} concluídos</Selo>}>
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-fundo" role="progressbar" aria-valuenow={feitos} aria-valuemin={0} aria-valuemax={ITENS_ADMISSAO.length}>
        <div className="h-full rounded-full bg-primaria transition-all" style={{ width: `${(feitos / ITENS_ADMISSAO.length) * 100}%` }} />
      </div>
      <ul className="flex flex-col divide-y divide-borda">
        {ITENS_ADMISSAO.map((k) => {
          const it = mapa.get(k); const def = ITENS[k]; const Icone = def.icone;
          return (
            <li key={k} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
              <span className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full ${it?.concluido ? "bg-sucesso-suave text-sucesso" : "bg-alerta-suave text-alerta"}`}>
                <Icone className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium">{def.rotulo}
                  {it?.concluido ? <CheckCircle2 className="size-4 text-sucesso" aria-label="Concluído" /> : <CircleDashed className="size-4 text-alerta" aria-label="Pendente" />}</p>
                <p className="text-sm text-texto-suave">
                  {it?.concluido ? <>Em {data(it.data)}{it.por ? ` · por ${it.por}` : ""}{it.detalhe ? ` · ${it.detalhe}` : ""}</> : def.como}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {!it?.concluido && (k === "cartao_vr" || k === "cracha") && podeEntregar && (
                  <Botao tamanho="sm" onClick={() => setRegistrando(k)}>Registrar entrega</Botao>
                )}
                {!it?.concluido && k === "uniforme" && pode("uniforme.ler", loja) && (
                  <Botao tamanho="sm" onClick={() => irPara("uniformes")}>Entregar uniforme</Botao>
                )}
                {!it?.concluido && k === "equipamento_epi" && (
                  <>
                    {podeEntregar && <Botao tamanho="sm" variante="secundaria" onClick={() => setRegistrando("epi_nao_tem")}>Não tem</Botao>}
                    {pode("equipamento.ler", loja) && <Botao tamanho="sm" onClick={() => irPara("equipamentos")}>Tem: registrar entrega</Botao>}
                  </>
                )}
                {!it?.concluido && k === "termo_imagem" && (
                  <>
                    <Botao tamanho="sm" variante="secundaria" icone={<Printer className="size-4" />} onClick={() => imprimirTermoImagem(c)}>Imprimir termo</Botao>
                    {podeAnexar && (
                      <label className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg bg-primaria px-3 text-xs font-medium text-white hover:opacity-90 ${enviando ? "pointer-events-none opacity-60" : ""}`}>
                        <Upload className="size-4" aria-hidden />{enviando ? "Enviando…" : "Anexar termo assinado"}
                        <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" disabled={enviando}
                          onChange={(e) => { anexarTermo(e.target.files?.[0]); e.target.value = ""; }} />
                      </label>
                    )}
                  </>
                )}
                {it?.concluido && it.origem === "manual" && it.registro_id && podeEntregar && (
                  <Botao tamanho="sm" variante="secundaria" icone={<Undo2 className="size-4" />} onClick={() => setDesfazendo(it)}>Desfazer</Botao>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-xs text-texto-suave">Obrigatórios em toda admissão. Enquanto faltar algum item, a pessoa aparece nas Pendências do Painel.</p>
      {registrando && <RegistrarEntrega c={c} item={registrando} fechar={() => setRegistrando(null)} />}
      {desfazendo?.registro_id && <Desfazer id={desfazendo.registro_id} rotulo={desfazendo.item === "equipamento_epi" ? "Não tem EPI / equipamento para entregar" : ITENS[desfazendo.item].rotulo} fechar={() => setDesfazendo(null)} />}
    </Cartao>
  );
}
