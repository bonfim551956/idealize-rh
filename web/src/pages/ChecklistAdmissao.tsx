import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, CheckCircle2, CircleDashed, CreditCard, FileSignature, HardHat, IdCard, Printer, Shirt, type LucideIcon } from "lucide-react";
import { supabase } from "../lib/supabase";
import { data } from "../lib/formato";
import type { ColaboradorLinha } from "../lib/dados";
import { AreaTexto, Botao, Campo, Cartao, Carregando, EstadoErro, Modal, Selo } from "../ui/componentes";

/* PRÉVIA — itens obrigatórios da admissão */
export type ItemChecklist = {
  item: "cartao_vr" | "uniforme" | "cracha" | "termo_imagem" | "equipamento_epi";
  concluido: boolean; data: string | null; por: string | null; detalhe: string | null; origem: "manual" | "uniformes" | "equipamentos" | "documento" | null;
};

const ITENS: Record<ItemChecklist["item"], { rotulo: string; icone: LucideIcon; como: string; acao: string }> = {
  cartao_vr:       { rotulo: "Entrega do cartão VR", icone: CreditCard, como: "Registre a data em que o cartão foi entregue.", acao: "Registrar entrega" },
  uniforme:        { rotulo: "Entrega de uniforme", icone: Shirt, como: "Conclui sozinho quando a entrega é lançada na aba Uniformes.", acao: "Entregar uniforme" },
  cracha:          { rotulo: "Entrega de crachá", icone: IdCard, como: "Registre a data da entrega (ou lance o crachá na aba Equipamentos).", acao: "Registrar entrega" },
  termo_imagem:    { rotulo: "Termo de uso de imagem", icone: FileSignature, como: "Imprima o termo padrão, colha a assinatura e anexe o termo assinado.", acao: "Anexar termo assinado" },
  equipamento_epi: { rotulo: "Entrega de equipamento / EPI", icone: HardHat, como: "Conclui sozinho quando a entrega é lançada na aba Equipamentos.", acao: "Registrar entrega" },
};
const ORDEM: ItemChecklist["item"][] = ["cartao_vr", "uniforme", "cracha", "termo_imagem", "equipamento_epi"];

export function ChecklistAdmissao({ c }: { c: ColaboradorLinha }) {
  const [registrando, setRegistrando] = useState<ItemChecklist["item"] | null>(null);
  const q = useQuery({
    queryKey: ["admissao-checklist", c.id],
    queryFn: async () => {
      const { data: r, error } = await supabase.rpc("admissao_checklist", { p_colaborador: c.id });
      if (error) throw new Error(error.message);
      return r as ItemChecklist[];
    },
  });
  if (q.isLoading) return <Carregando />;
  if (q.error) return <EstadoErro mensagem={(q.error as Error).message} tentarNovamente={() => q.refetch()} />;
  const mapa = new Map(q.data!.map((i) => [i.item, i]));
  const feitos = ORDEM.filter((k) => mapa.get(k)?.concluido).length;

  return (
    <Cartao titulo={<span className="inline-flex items-center gap-2"><BadgeCheck className="size-4 text-texto-suave" aria-hidden />Itens obrigatórios da admissão</span>}
      acao={<Selo tom={feitos === ORDEM.length ? "sucesso" : "alerta"}>{feitos} de {ORDEM.length} concluídos</Selo>}>
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-fundo" role="progressbar" aria-valuenow={feitos} aria-valuemin={0} aria-valuemax={ORDEM.length}>
        <div className="h-full rounded-full bg-primaria transition-all" style={{ width: `${(feitos / ORDEM.length) * 100}%` }} />
      </div>
      <ul className="flex flex-col divide-y divide-borda">
        {ORDEM.map((k) => {
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
              {!it?.concluido && (
                <div className="flex shrink-0 gap-2">
                  {k === "termo_imagem" && <Botao tamanho="sm" variante="secundaria" icone={<Printer className="size-4" />}>Imprimir termo</Botao>}
                  <Botao tamanho="sm" onClick={() => setRegistrando(k)}>{def.acao}</Botao>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {registrando && (registrando === "cartao_vr" || registrando === "cracha") && (
        <Modal aberto aoFechar={() => setRegistrando(null)} titulo={ITENS[registrando].rotulo} descricao={c.nome_completo}>
          <div className="flex flex-col gap-4">
            <Campo rotulo="Data da entrega" type="date" obrigatorio defaultValue="2026-11-03" />
            <AreaTexto rotulo="Observação" rows={2} placeholder="Opcional" />
            <div className="flex justify-end gap-2">
              <Botao variante="secundaria" onClick={() => setRegistrando(null)}>Cancelar</Botao>
              <Botao onClick={() => setRegistrando(null)}>Salvar</Botao>
            </div>
          </div>
        </Modal>
      )}
    </Cartao>
  );
}
