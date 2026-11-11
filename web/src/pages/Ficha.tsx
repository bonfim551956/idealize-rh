import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRightLeft, BadgeCheck, BadgeDollarSign, Eye, EyeOff, FileSignature, Pencil, TrendingUp, UserMinus, Workflow } from "lucide-react";
import { GerarTermo } from "./Termos";
import { AdvertenciasColaborador } from "./Advertencias";
import { mensagemErro, supabase } from "../lib/supabase";
import { falhar, useCargos, useLojas, type ColaboradorLinha } from "../lib/dados";
import { SIGILO, STATUS_VINCULO, data, dataHora, hoje, mascaraTelefone, moeda, so_digitos } from "../lib/formato";
import { useAuth } from "../auth/AuthProvider";
import { AreaTexto, Aviso, Botao, Campo, Cartao, Carregando, EstadoErro, EstadoVazio, Modal, Selecao, Selo, cx, useAvisos } from "../ui/componentes";
import { ListaDocumentos } from "./Documentos";
import { UniformesColaborador } from "./Uniformes";
import { EquipamentosColaborador } from "./Equipamentos";
import { FichaCompleta } from "./FichaCompleta";
import { ChecklistAdmissao, ITENS_ADMISSAO, useChecklistAdmissao } from "./ChecklistAdmissao";

type Evento = { id: string; tipo: string; data_evento: string; titulo: string; descricao: string | null; sigilo: string; origem: string; registrado_em: string };

export function Ficha() {
  const { id } = useParams<{ id: string }>();
  const { pode } = useAuth();
  const [params] = useSearchParams();
  const abaInicial = params.get("aba");
  const irPara = (secao: string) => document.getElementById(`secao-${secao}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  useEffect(() => { if (abaInicial) setTimeout(() => irPara(abaInicial), 400); }, [abaInicial]);
  const checklist = useChecklistAdmissao(id);
  const q = useQuery({
    queryKey: ["colaborador", id],
    queryFn: async () => falhar(await supabase.from("v_colaboradores").select("*").eq("id", id!).maybeSingle()) as ColaboradorLinha | null,
  });

  if (q.isLoading) return <Carregando />;
  if (q.error) return <EstadoErro mensagem={(q.error as Error).message} tentarNovamente={() => q.refetch()} />;
  const c = q.data;
  if (!c) return <EstadoVazio titulo="Colaborador não encontrado" descricao="Ele não existe ou você não tem acesso à loja dele." acao={<Link to="/colaboradores"><Botao variante="secundaria">Voltar</Botao></Link>} />;
  const loja = c.loja_atual_id;
  const status = c.status ? STATUS_VINCULO[c.status] : null;

  const abas: { valor: string; rotulo: string; visivel: boolean; conteudo: ReactNode }[] = [
    { valor: "geral", rotulo: "Visão geral", visivel: true, conteudo: <VisaoGeral c={c} /> },
    { valor: "admissao", rotulo: checklist.data ? `Admissão (${checklist.data.filter((i) => i.concluido).length}/${ITENS_ADMISSAO.length})` : "Admissão",
      visivel: !!c.status && !["desligado", "arquivado", "em_desligamento"].includes(c.status), conteudo: <ChecklistAdmissao c={c} irPara={irPara} /> },
    { valor: "historico", rotulo: "Movimentações", visivel: true, conteudo: <Historico c={c} /> },
    { valor: "documentos", rotulo: "Documentos", visivel: true, conteudo: <ListaDocumentos colaborador={c} /> },
    { valor: "uniformes", rotulo: "Uniformes", visivel: pode("uniforme.ler", loja), conteudo: <UniformesColaborador c={c} /> },
    { valor: "equipamentos", rotulo: "Equipamentos", visivel: pode("equipamento.ler", loja), conteudo: <EquipamentosColaborador c={c} /> },
    { valor: "advertencias", rotulo: "Advertências", visivel: pode("documento.disciplinar.ler", loja), conteudo: <AdvertenciasColaborador c={c} /> },
    { valor: "timeline", rotulo: "Linha do tempo", visivel: true, conteudo: <LinhaDoTempo c={c} /> },
  ];
  const visiveis = abas.filter((a) => a.visivel);

  return (
    <>
      <Link to="/colaboradores" className="mb-4 inline-flex items-center gap-1 text-sm text-primaria hover:underline"><ArrowLeft className="size-4" /> Colaboradores</Link>
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{c.nome_social || c.nome_completo}</h1>
          <p className="mt-1 text-sm text-texto-suave">
            {c.nome_social && <>{c.nome_completo} · </>}{c.cargo_nome ?? "Sem cargo"} · {c.loja_nome} · Matrícula {c.matricula ?? "—"}
          </p>
        </div>
        {status && <Selo tom={status.tom}>{status.rotulo}</Selo>}
      </div>

      {/* índice fixo: leva a cada seção da página */}
      <nav aria-label="Seções da ficha" className="sticky top-0 z-10 -mx-4 mb-6 flex gap-1 overflow-x-auto border-b border-borda bg-fundo/95 px-4 py-2 backdrop-blur sm:-mx-0 sm:px-0">
        {visiveis.map((a) => (
          <button key={a.valor} type="button" onClick={() => irPara(a.valor)}
            className="h-9 shrink-0 rounded-full px-3 text-sm font-medium text-texto-suave hover:bg-superficie hover:text-texto">
            {a.rotulo}
          </button>
        ))}
      </nav>
      <div className="flex flex-col gap-10">
        {visiveis.map((a) => (
          <section key={a.valor} id={`secao-${a.valor}`} aria-labelledby={`titulo-${a.valor}`} className="scroll-mt-16">
            <h2 id={`titulo-${a.valor}`} className={a.valor === "documentos" ? "sr-only" : "mb-3 text-lg font-semibold"}>{a.rotulo}</h2>
            {a.conteudo}
          </section>
        ))}
      </div>
      <p className="mt-8 text-xs text-texto-suave">Contratos, exames, jornada, férias, ocorrências, treinamentos e avaliações chegam nas próximas etapas.</p>
    </>
  );
}


/* ---------------- Visão geral + ações ---------------- */
function VisaoGeral({ c }: { c: ColaboradorLinha }) {
  const { pode } = useAuth();
  const loja = c.loja_atual_id;
  const [acao, setAcao] = useState<"transferir" | "status" | "cargo" | "salario" | "desligar" | "concluir" | "editar" | "efetivar" | "termo" | null>(null);
  const encerrado = c.status === "desligado" || c.status === "arquivado";

  const desligamento = useQuery({
    queryKey: ["desligamento", c.vinculo_id],
    enabled: c.status === "em_desligamento" && pode("desligamento.gerir", loja),
    queryFn: async () => falhar(await supabase.from("desligamentos").select("id,modalidade,data_comunicacao,status,aviso_tipo,aviso_reducao,aviso_dias,fim_aviso,ultimo_dia").eq("vinculo_id", c.vinculo_id!).eq("status", "em_andamento").maybeSingle()) as
      { id: string; modalidade: string; data_comunicacao: string; status: string; aviso_tipo: string | null; aviso_reducao: string | null;
        aviso_dias: number | null; fim_aviso: string | null; ultimo_dia: string | null } | null,
  });

  const botoes = [
    { k: "efetivar" as const, rotulo: "Efetivar contrato (fim da experiência)", icone: BadgeCheck, ok: pode("colaborador.editar", loja) && !encerrado && c.tipo === "clt_experiencia" && c.status !== "em_desligamento" },
    { k: "editar" as const, rotulo: "Editar dados do vínculo", icone: Pencil, ok: pode("colaborador.editar", loja) && !encerrado },
    { k: "status" as const, rotulo: "Mudar situação", icone: Workflow, ok: pode("vinculo.status.alterar", loja) && !encerrado },
    { k: "transferir" as const, rotulo: "Transferir de loja", icone: ArrowRightLeft, ok: pode("colaborador.transferir", loja) && !encerrado },
    { k: "cargo" as const, rotulo: "Promoção / mudança de função", icone: TrendingUp, ok: pode("cargo.alterar", loja) && !encerrado },
    { k: "salario" as const, rotulo: "Alteração salarial", icone: BadgeDollarSign, ok: pode("remuneracao.gerir", loja) && !encerrado },
    { k: "termo" as const, rotulo: "Gerar termo (uniforme, EPI, equipamento, imagem)", icone: FileSignature, ok: pode("colaborador.ler", loja) },
    { k: "desligar" as const, rotulo: "Iniciar desligamento", icone: UserMinus, ok: pode("desligamento.gerir", loja) && c.status !== "em_desligamento" && !encerrado && c.status !== "pre_admissao" && c.status !== "em_admissao" },
  ].filter((b) => b.ok);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2"><FichaCompleta c={c} salario={pode("remuneracao.ler", loja) ? <SalarioAtual vinculo={c.vinculo_id} /> : null}
        contatos={<ContatosEmergencia c={c} podeEditar={pode("colaborador.dados_pessoais.editar", loja)} />} /></div>

      <div><Cartao titulo="Ações" className="lg:sticky lg:top-16">
        {c.status === "em_desligamento" && desligamento.data && (
          <div className="mb-4 flex flex-col gap-2">
            <Aviso tom="alerta">
              Desligamento em andamento ({desligamento.data.modalidade.replace(/_/g, " ")}) desde {data(desligamento.data.data_comunicacao)}.
              {desligamento.data.aviso_tipo && (
                <span className="mt-1 block">
                  {AVISO_ROTULO[desligamento.data.aviso_tipo] ?? desligamento.data.aviso_tipo}
                  {desligamento.data.aviso_reducao && ` · ${desligamento.data.aviso_reducao === "7_dias" ? "sai 7 dias antes" : "sai 2h mais cedo por dia"}`}
                  {desligamento.data.fim_aviso && ` · aviso até ${data(desligamento.data.fim_aviso)}`}
                  {desligamento.data.ultimo_dia && <> · <strong>último dia: {data(desligamento.data.ultimo_dia)}</strong></>}
                </span>
              )}
            </Aviso>
            <Botao variante="perigo" onClick={() => setAcao("concluir")}>Concluir desligamento</Botao>
          </div>
        )}
        {botoes.length === 0 && !desligamento.data && <p className="text-sm text-texto-suave">Seu perfil não tem ações disponíveis para este colaborador.</p>}
        <div className="flex flex-col gap-2">
          {botoes.map(({ k, rotulo, icone: I }) => (
            <Botao key={k} variante="secundaria" className="justify-start" icone={<I className="size-4" />} onClick={() => setAcao(k)}>{rotulo}</Botao>
          ))}
        </div>
      </Cartao></div>

      {acao === "efetivar" && <EfetivarContrato c={c} fechar={() => setAcao(null)} />}
      {acao === "editar" && <EditarVinculo c={c} fechar={() => setAcao(null)} />}
      {acao === "status" && <MudarStatus c={c} fechar={() => setAcao(null)} />}
      {acao === "transferir" && <Transferir c={c} fechar={() => setAcao(null)} />}
      {acao === "cargo" && <MudarCargo c={c} fechar={() => setAcao(null)} />}
      {acao === "salario" && <MudarSalario c={c} fechar={() => setAcao(null)} />}
      {acao === "termo" && <GerarTermo c={c} fechar={() => setAcao(null)} />}
      {acao === "desligar" && <IniciarDesligamento c={c} fechar={() => setAcao(null)} />}
      {acao === "concluir" && desligamento.data && <ConcluirDesligamento c={c} id={desligamento.data.id} ultimoDia={desligamento.data.ultimo_dia} fechar={() => setAcao(null)} />}
    </div>
  );
}

function SalarioAtual({ vinculo }: { vinculo: string | null }) {
  const [ver, setVer] = useState(false);
  const q = useQuery({
    queryKey: ["salario", vinculo],
    enabled: ver && !!vinculo,
    queryFn: async () => falhar(await supabase.from("remuneracoes").select("salario_base,vigencia_inicio").eq("vinculo_id", vinculo!)
      .lte("vigencia_inicio", hoje()).order("vigencia_inicio", { ascending: false }).limit(1).maybeSingle()) as { salario_base: number; vigencia_inicio: string } | null,
  });
  return (
    <div className="mt-6 flex items-center justify-between rounded-lg bg-fundo px-4 py-3">
      <div>
        <p className="text-xs text-texto-suave">Salário contratual</p>
        <p className="text-sm font-medium">{ver ? (q.isLoading ? "…" : q.data ? `${moeda(q.data.salario_base)} desde ${data(q.data.vigencia_inicio)}` : "Não informado") : "••••••"}</p>
      </div>
      <Botao tamanho="sm" variante="fantasma" onClick={() => setVer((v) => !v)} icone={ver ? <EyeOff className="size-4" /> : <Eye className="size-4" />}>{ver ? "Ocultar" : "Mostrar"}</Botao>
    </div>
  );
}

/* ---------------- Formulários de ação ---------------- */
function useAcao(_c: ColaboradorLinha, fechar: () => void, sucesso: string) {
  const qc = useQueryClient();
  const avisar = useAvisos();
  return (fn: () => PromiseLike<{ error: unknown }>) => ({
    mutationFn: async () => { const { error } = await fn(); if (error) throw error; },
    onSuccess: () => {
      ["colaborador", "colaboradores", "timeline", "historico", "salario", "desligamento", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      avisar("sucesso", sucesso); fechar();
    },
    onError: (e: unknown) => avisar("erro", mensagemErro(e)),
  });
}

function Rodape({ fechar, carregando, texto = "Salvar", desabilitado }: { fechar: () => void; carregando: boolean; texto?: string; desabilitado?: boolean }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Botao type="button" variante="secundaria" onClick={fechar}>Cancelar</Botao>
      <Botao type="submit" carregando={carregando} disabled={desabilitado}>{texto}</Botao>
    </div>
  );
}

function EfetivarContrato({ c, fechar }: { c: ColaboradorLinha; fechar: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ data: hoje(), obs: "" });
  const m = useMutation(useAcao(c, fechar, "Contrato efetivado: prazo indeterminado.")(() =>
    supabase.rpc("efetivar_contrato", { p_vinculo: c.vinculo_id, p_data: f.data, p_observacao: f.obs || null })));
  const ok = !!f.data && !!c.data_admissao && f.data > c.data_admissao;
  return (
    <Modal aberto aoFechar={fechar} titulo="Efetivar contrato" descricao="O contrato de experiência passa a ser por prazo indeterminado a partir da data informada.">
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(undefined, { onSuccess: () => qc.invalidateQueries({ queryKey: ["painel-avisos"] }) }); }} className="flex flex-col gap-4">
        <Aviso tom="info">Admissão em {data(c.data_admissao)}. Normalmente a efetivação é o dia seguinte ao fim da experiência.</Aviso>
        <Campo rotulo="Prazo indeterminado a partir de" type="date" obrigatorio value={f.data} min={c.data_admissao ?? undefined} onChange={(e) => setF({ ...f, data: e.target.value })} />
        <AreaTexto rotulo="Observação" value={f.obs} onChange={(e) => setF({ ...f, obs: e.target.value })} rows={2} />
        <Rodape fechar={fechar} carregando={m.isPending} texto="Efetivar" desabilitado={!ok} />
      </form>
    </Modal>
  );
}

function EditarVinculo({ c, fechar }: { c: ColaboradorLinha; fechar: () => void }) {
  const [f, setF] = useState({ jornada_semanal_horas: String(c.jornada_semanal_horas ?? ""), escala: c.escala ?? "", data_admissao: c.data_admissao ?? "" });
  const preAdmissao = c.status === "pre_admissao" || c.status === "em_admissao";
  const m = useMutation(useAcao(c, fechar, "Dados atualizados.")(() => {
    const p: Record<string, string> = { jornada_semanal_horas: f.jornada_semanal_horas, escala: f.escala };
    if (preAdmissao) p.data_admissao = f.data_admissao;
    return supabase.rpc("atualizar_vinculo", { p_vinculo: c.vinculo_id, p });
  }));
  return (
    <Modal aberto aoFechar={fechar} titulo="Editar dados do vínculo">
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        <Campo rotulo="Jornada semanal (horas)" type="number" min={1} max={44} value={f.jornada_semanal_horas} onChange={(e) => setF({ ...f, jornada_semanal_horas: e.target.value })} />
        <Campo rotulo="Escala" value={f.escala} onChange={(e) => setF({ ...f, escala: e.target.value })} />
        {preAdmissao && <Campo rotulo="Data de admissão prevista" type="date" value={f.data_admissao} onChange={(e) => setF({ ...f, data_admissao: e.target.value })} />}
        <Rodape fechar={fechar} carregando={m.isPending} />
      </form>
    </Modal>
  );
}

function MudarStatus({ c, fechar }: { c: ColaboradorLinha; fechar: () => void }) {
  const transicoes = useQuery({
    queryKey: ["transicoes", c.status],
    queryFn: async () => falhar(await supabase.from("status_transicoes").select("para,requisito").eq("de", c.status!)) as { para: string; requisito: string | null }[],
  });
  // desligamento tem fluxo próprio
  const opcoes = (transicoes.data ?? []).filter((t) => !t.requisito && t.para !== "em_desligamento");
  const [f, setF] = useState({ para: "", motivo: "", data: hoje() });
  const m = useMutation(useAcao(c, fechar, "Situação atualizada.")(() =>
    supabase.rpc("alterar_status_vinculo", { p_vinculo: c.vinculo_id, p_novo: f.para, p_motivo: f.motivo, p_data_efeito: f.data })));
  return (
    <Modal aberto aoFechar={fechar} titulo="Mudar situação" descricao={`Situação atual: ${STATUS_VINCULO[c.status!]?.rotulo}`}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        {transicoes.isLoading ? <Carregando /> : opcoes.length === 0 ? <Aviso>Não há mudanças de situação disponíveis a partir de agora.</Aviso> : (
          <Selecao rotulo="Nova situação" value={f.para} onChange={(e) => setF({ ...f, para: e.target.value })} obrigatorio>
            <option value="">Selecione</option>
            {opcoes.map((o) => <option key={o.para} value={o.para}>{STATUS_VINCULO[o.para]?.rotulo ?? o.para}</option>)}
          </Selecao>
        )}
        <Campo rotulo="Data de efeito" type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} obrigatorio />
        <AreaTexto rotulo="Motivo" value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} obrigatorio
          dica={["afastado", "em_licenca"].includes(f.para) ? "Não descreva diagnóstico aqui. Documentos médicos vão na categoria de saúde." : undefined} />
        <Rodape fechar={fechar} carregando={m.isPending} desabilitado={!f.para || !f.motivo.trim()} />
      </form>
    </Modal>
  );
}

function Transferir({ c, fechar }: { c: ColaboradorLinha; fechar: () => void }) {
  const { pode } = useAuth();
  const lojas = useLojas();
  const destinos = (lojas.data ?? []).filter((l) => l.ativa && l.id !== c.loja_atual_id && pode("colaborador.transferir", l.id));
  const mesmaEmpresa = destinos.filter((l) => l.empresa_id === c.empresa_id);
  const [f, setF] = useState({ loja: "", data: hoje(), motivo: "" });
  const m = useMutation(useAcao(c, fechar, "Transferência registrada.")(() =>
    supabase.rpc("transferir_colaborador", { p_colaborador: c.id, p_loja_destino: f.loja, p_data: f.data, p_motivo: f.motivo })));
  return (
    <Modal aberto aoFechar={fechar} titulo="Transferir de loja" descricao={`Loja atual: ${c.loja_nome}`}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        {mesmaEmpresa.length === 0 ? (
          <Aviso tom="alerta">Não há outra loja do mesmo CNPJ. Transferência entre empresas diferentes do grupo exige um processo próprio, ainda pendente de validação com a contabilidade.</Aviso>
        ) : (
          <>
            <Selecao rotulo="Loja de destino" value={f.loja} onChange={(e) => setF({ ...f, loja: e.target.value })} obrigatorio>
              <option value="">Selecione</option>
              {mesmaEmpresa.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </Selecao>
            <p className="text-xs text-texto-suave">Só aparecem lojas do mesmo CNPJ. Entre empresas diferentes, o processo é outro (pendente de validação contábil).</p>
          </>
        )}
        <Campo rotulo="Data da transferência" type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} obrigatorio />
        <AreaTexto rotulo="Motivo" value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} obrigatorio />
        <Rodape fechar={fechar} carregando={m.isPending} texto="Transferir" desabilitado={!f.loja || !f.motivo.trim()} />
      </form>
    </Modal>
  );
}

function MudarCargo({ c, fechar }: { c: ColaboradorLinha; fechar: () => void }) {
  const cargos = useCargos();
  const [f, setF] = useState({ cargo: "", tipo: "promocao", data: hoje(), motivo: "" });
  const m = useMutation(useAcao(c, fechar, "Cargo atualizado.")(() =>
    supabase.rpc("alterar_cargo", { p_vinculo: c.vinculo_id, p_cargo: f.cargo, p_data: f.data, p_tipo: f.tipo, p_motivo: f.motivo })));
  return (
    <Modal aberto aoFechar={fechar} titulo="Promoção ou mudança de função" descricao={`Cargo atual: ${c.cargo_nome ?? "—"}`}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        <Selecao rotulo="Tipo" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
          <option value="promocao">Promoção</option>
          <option value="mudanca_funcao">Mudança de função</option>
          <option value="correcao">Correção de cadastro</option>
        </Selecao>
        <Selecao rotulo="Novo cargo" value={f.cargo} onChange={(e) => setF({ ...f, cargo: e.target.value })} obrigatorio>
          <option value="">Selecione</option>
          {cargos.data?.filter((x) => x.ativo && x.id !== c.cargo_id).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
        </Selecao>
        <Campo rotulo="A partir de" type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} obrigatorio />
        <AreaTexto rotulo="Motivo" value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} obrigatorio />
        <Rodape fechar={fechar} carregando={m.isPending} desabilitado={!f.cargo || !f.motivo.trim()} />
      </form>
    </Modal>
  );
}

function MudarSalario({ c, fechar }: { c: ColaboradorLinha; fechar: () => void }) {
  const [f, setF] = useState({ valor: "", vigencia: hoje(), motivo: "" });
  const m = useMutation(useAcao(c, fechar, "Alteração salarial registrada.")(() =>
    supabase.rpc("registrar_remuneracao", { p_vinculo: c.vinculo_id, p_valor: Number(f.valor), p_vigencia: f.vigencia, p_motivo: f.motivo })));
  return (
    <Modal aberto aoFechar={fechar} titulo="Alteração salarial" descricao="Fica no histórico e na auditoria. A folha oficial continua com a contabilidade.">
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        <Campo rotulo="Novo salário (R$)" type="number" step="0.01" min="0" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} obrigatorio />
        <Campo rotulo="Vigência a partir de" type="date" value={f.vigencia} onChange={(e) => setF({ ...f, vigencia: e.target.value })} obrigatorio />
        <AreaTexto rotulo="Motivo" value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} obrigatorio />
        <Rodape fechar={fechar} carregando={m.isPending} desabilitado={!(Number(f.valor) > 0) || !f.motivo.trim()} />
      </form>
    </Modal>
  );
}

const MODALIDADES = [
  ["pedido_demissao", "Pedido de demissão"], ["sem_justa_causa", "Dispensa sem justa causa"], ["justa_causa", "Dispensa por justa causa"],
  ["acordo", "Acordo entre as partes"], ["termino_experiencia", "Término do contrato de experiência"],
  ["termino_prazo_determinado", "Término de contrato por prazo determinado"], ["outra", "Outra"],
] as const;

type AvisoTipo = "trabalhado" | "indenizado" | "dispensado" | "nao_cumpre";
const somaDiasISO = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
/* aviso prévio: 30 dias + 3 por ano completo de casa (Lei 12.506/2011), até 90 — só quando a empresa dispensa */
function diasAviso(admissao: string | null, comunicacao: string, modalidade: string) {
  if (modalidade !== "sem_justa_causa" || !admissao) return 30;
  const a = new Date(`${admissao}T12:00:00`), c = new Date(`${comunicacao}T12:00:00`);
  let anos = c.getFullYear() - a.getFullYear();
  if (c.getMonth() < a.getMonth() || (c.getMonth() === a.getMonth() && c.getDate() < a.getDate())) anos--;
  return Math.min(90, 30 + 3 * Math.max(0, anos));
}

function IniciarDesligamento({ c, fechar }: { c: ColaboradorLinha; fechar: () => void }) {
  const [f, setF] = useState({ modalidade: "", data: hoje(), obs: "", aviso: "" as AvisoTipo | "", reducao: "" as "" | "2h_dia" | "7_dias", ultimo: "" });
  const comAviso = ["pedido_demissao", "sem_justa_causa", "acordo"].includes(f.modalidade);
  const opcoes: [AvisoTipo, string, string][] = f.modalidade === "pedido_demissao"
    ? [["trabalhado", "Vai cumprir o aviso", "Trabalha os 30 dias do aviso"],
       ["dispensado", "Empresa dispensa o cumprimento", "Sai na data combinada, sem desconto"],
       ["nao_cumpre", "Não vai cumprir", "Sai antes; o aviso pode ser descontado na rescisão"]]
    : [["trabalhado", "Aviso trabalhado", "Trabalha durante o aviso, com redução de jornada"],
       ["indenizado", "Aviso indenizado", "Sai na hora; o aviso é pago na rescisão"]];
  const dias = diasAviso(c.data_admissao, f.data, f.modalidade) / (f.modalidade === "acordo" ? 2 : 1);
  const fimAviso = somaDiasISO(f.data, Math.ceil(dias) - 1);
  const sugerido = f.aviso === "trabalhado" ? (f.reducao === "7_dias" ? somaDiasISO(fimAviso, -7) : fimAviso) : f.data;
  const ultimo = f.ultimo || sugerido;
  const precisaReducao = f.aviso === "trabalhado" && f.modalidade !== "pedido_demissao";
  const valido = !!f.modalidade && (!comAviso || (!!f.aviso && (!precisaReducao || !!f.reducao)));
  const m = useMutation(useAcao(c, fechar, "Desligamento iniciado.")(() =>
    supabase.rpc("iniciar_desligamento", { p_vinculo: c.vinculo_id, p_modalidade: f.modalidade, p_data_comunicacao: f.data, p_observacoes: f.obs || null,
      p_aviso: comAviso ? { tipo: f.aviso, reducao: precisaReducao ? f.reducao : null, dias: Math.ceil(dias), fim_aviso: fimAviso, ultimo_dia: ultimo } : null })));
  const radio = (nome: string, valor: string, atual: string, onSel: () => void, titulo: string, desc: string) => (
    <label key={valor} className={cx("flex cursor-pointer gap-3 rounded-lg border p-3", atual === valor ? "border-primaria bg-primaria-suave" : "border-borda")}>
      <input type="radio" name={nome} checked={atual === valor} onChange={onSel} className="mt-1 accent-[var(--color-primaria)]" />
      <span><span className="block text-sm font-medium">{titulo}</span><span className="text-xs text-texto-suave">{desc}</span></span>
    </label>
  );
  return (
    <Modal aberto aoFechar={fechar} titulo="Iniciar desligamento" descricao={c.nome_completo} largura="max-w-xl">
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (valido) m.mutate(); }} className="flex flex-col gap-4">
        <Selecao rotulo="Modalidade" value={f.modalidade} onChange={(e) => setF({ ...f, modalidade: e.target.value, aviso: "", reducao: "", ultimo: "" })} obrigatorio>
          <option value="">Selecione</option>
          {MODALIDADES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Selecao>
        <Campo rotulo="Data da comunicação" type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value, ultimo: "" })} obrigatorio />
        {comAviso && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Aviso prévio <span className="text-perigo">*</span></legend>
            {opcoes.map(([v, t, d]) => radio("aviso", v, f.aviso, () => setF({ ...f, aviso: v, reducao: "", ultimo: "" }), t, d))}
          </fieldset>
        )}
        {precisaReducao && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Redução durante o aviso <span className="text-perigo">*</span></legend>
            {radio("reducao", "2h_dia", f.reducao, () => setF({ ...f, reducao: "2h_dia", ultimo: "" }), "Sai 2 horas mais cedo por dia", "Trabalha todos os dias do aviso com jornada reduzida")}
            {radio("reducao", "7_dias", f.reducao, () => setF({ ...f, reducao: "7_dias", ultimo: "" }), "Sai 7 dias antes", "Trabalha jornada normal e deixa de trabalhar nos últimos 7 dias corridos")}
          </fieldset>
        )}
        {comAviso && f.aviso && (
          <div className="grid gap-4 rounded-lg bg-fundo p-3 sm:grid-cols-2">
            <div className="text-sm">
              <p className="text-xs text-texto-suave">Aviso prévio</p>
              <p className="font-medium">{Math.ceil(dias)} dias · até {data(fimAviso)}</p>
              {f.modalidade === "sem_justa_causa" && <p className="text-xs text-texto-suave">30 dias + 3 por ano completo de empresa</p>}
              {f.modalidade === "acordo" && <p className="text-xs text-texto-suave">Metade do aviso, no acordo</p>}
            </div>
            <Campo rotulo="Último dia de trabalho" type="date" value={ultimo} onChange={(e) => setF({ ...f, ultimo: e.target.value })} obrigatorio
              dica="Calculado; ajuste se foi combinado outro dia" />
          </div>
        )}
        <AreaTexto rotulo="Observações" value={f.obs} onChange={(e) => setF({ ...f, obs: e.target.value })} />
        <Aviso tom="info">Confirme os cálculos da rescisão com a contabilidade.</Aviso>
        <Rodape fechar={fechar} carregando={m.isPending} texto="Iniciar" desabilitado={!valido} />
      </form>
    </Modal>
  );
}

const AVISO_ROTULO: Record<string, string> = {
  trabalhado: "Aviso trabalhado", indenizado: "Aviso indenizado", dispensado: "Empresa dispensou o cumprimento", nao_cumpre: "Não vai cumprir o aviso",
};

function ConcluirDesligamento({ c, id, ultimoDia, fechar }: { c: ColaboradorLinha; id: string; ultimoDia: string | null; fechar: () => void }) {
  const [d, setD] = useState(ultimoDia ?? hoje());
  const [ok, setOk] = useState(false);
  const m = useMutation(useAcao(c, fechar, "Desligamento concluído. O cadastro e os documentos continuam guardados.")(() =>
    supabase.rpc("concluir_desligamento", { p_desligamento: id, p_data_desligamento: d })));
  return (
    <Modal aberto aoFechar={fechar} titulo="Concluir desligamento" descricao={c.nome_completo}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        <Campo rotulo="Data do desligamento" type="date" value={d} onChange={(e) => setD(e.target.value)} obrigatorio />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={ok} onChange={(e) => setOk(e.target.checked)} />
          Confirmo que as providências rescisórias foram tratadas com a contabilidade.
        </label>
        <Rodape fechar={fechar} carregando={m.isPending} texto="Concluir" desabilitado={!ok} />
      </form>
    </Modal>
  );
}

/* ---------------- Contato de emergência ---------------- */
export function ContatosEmergencia({ c, podeEditar }: { c: ColaboradorLinha; podeEditar: boolean }) {
  const qc = useQueryClient();
  const avisar = useAvisos();
  const [novo, setNovo] = useState<{ nome: string; parentesco: string; telefone: string } | null>(null);
  const q = useQuery({
    queryKey: ["contatos", c.id],
    queryFn: async () => falhar(await supabase.from("contatos_emergencia").select("id,nome,parentesco,telefone").eq("colaborador_id", c.id)) as
      { id: string; nome: string; parentesco: string | null; telefone: string }[],
  });
  const m = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("contatos_emergencia").insert({ colaborador_id: c.id, nome: novo!.nome, parentesco: novo!.parentesco || null, telefone: so_digitos(novo!.telefone) });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["contatos", c.id] }); setNovo(null); avisar("sucesso", "Contato adicionado."); },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  return (
    <Cartao titulo="Contatos de emergência" acao={podeEditar && !novo && <Botao tamanho="sm" variante="secundaria" onClick={() => setNovo({ nome: "", parentesco: "", telefone: "" })}>Adicionar</Botao>}>
      {q.isLoading ? <Carregando /> : q.data?.length === 0 && !novo ? <p className="text-sm text-texto-suave">Nenhum contato cadastrado.</p> : (
        <ul className="flex flex-col gap-3">
          {q.data?.map((k) => <li key={k.id} className="text-sm"><span className="font-medium">{k.nome}</span>{k.parentesco && ` (${k.parentesco})`} · {mascaraTelefone(k.telefone)}</li>)}
        </ul>
      )}
      {novo && (
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }} className="mt-4 flex flex-col gap-3">
          <Campo rotulo="Nome" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} obrigatorio />
          <Campo rotulo="Parentesco" value={novo.parentesco} onChange={(e) => setNovo({ ...novo, parentesco: e.target.value })} />
          <Campo rotulo="Telefone" value={mascaraTelefone(novo.telefone)} onChange={(e) => setNovo({ ...novo, telefone: e.target.value })} obrigatorio />
          <Rodape fechar={() => setNovo(null)} carregando={m.isPending} desabilitado={!novo.nome.trim() || so_digitos(novo.telefone).length < 10} />
        </form>
      )}
    </Cartao>
  );
}

/* ---------------- Histórico ---------------- */
function Historico({ c }: { c: ColaboradorLinha }) {
  const { pode } = useAuth();
  const q = useQuery({
    queryKey: ["historico", c.id],
    queryFn: async () => {
      const vincs = falhar(await supabase.from("vinculos").select("id").eq("colaborador_id", c.id)) as { id: string }[];
      const ids = vincs.map((v) => v.id);
      if (!ids.length) return { lot: [], car: [], st: [], sal: [] };
      const [lot, car, st, sal] = await Promise.all([
        supabase.from("lotacoes").select("id,inicio,fim,motivo,lojas(nome)").in("vinculo_id", ids).order("inicio", { ascending: false }),
        supabase.from("historico_cargos").select("id,inicio,fim,tipo,motivo,cargos(nome)").in("vinculo_id", ids).order("inicio", { ascending: false }),
        supabase.from("vinculo_status_historico").select("id,de,para,motivo,data_efeito").in("vinculo_id", ids).order("registrado_em", { ascending: false }),
        pode("remuneracao.ler", c.loja_atual_id)
          ? supabase.from("remuneracoes").select("id,salario_base,vigencia_inicio,motivo").in("vinculo_id", ids).order("vigencia_inicio", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
      ]);
      return {
        lot: falhar(lot) as unknown as { id: string; inicio: string; fim: string | null; motivo: string | null; lojas: { nome: string } | null }[],
        car: falhar(car) as unknown as { id: string; inicio: string; fim: string | null; tipo: string; motivo: string | null; cargos: { nome: string } | null }[],
        st: falhar(st) as { id: number; de: string | null; para: string; motivo: string | null; data_efeito: string }[],
        sal: falhar(sal) as { id: string; salario_base: number; vigencia_inicio: string; motivo: string }[],
      };
    },
  });
  if (q.isLoading) return <Carregando />;
  if (q.error) return <EstadoErro mensagem={(q.error as Error).message} />;
  const h = q.data!;
  const periodo = (i: string, f: string | null) => `${data(i)} → ${f ? data(f) : "atual"}`;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Cartao titulo="Lotação (lojas)">
        <ul className="flex flex-col gap-3">{h.lot.map((l) => <li key={l.id} className="text-sm"><p className="font-medium">{l.lojas?.nome}</p><p className="text-xs text-texto-suave">{periodo(l.inicio, l.fim)}{l.motivo && ` · ${l.motivo}`}</p></li>)}</ul>
      </Cartao>
      <Cartao titulo="Cargos">
        {h.car.length === 0 ? <p className="text-sm text-texto-suave">Sem cargo registrado.</p> :
          <ul className="flex flex-col gap-3">{h.car.map((x) => <li key={x.id} className="text-sm"><p className="font-medium">{x.cargos?.nome}</p><p className="text-xs text-texto-suave">{periodo(x.inicio, x.fim)} · {x.tipo.replace(/_/g, " ")}{x.motivo && ` · ${x.motivo}`}</p></li>)}</ul>}
      </Cartao>
      <Cartao titulo="Situações">
        <ul className="flex flex-col gap-3">{h.st.map((s) => (
          <li key={s.id} className="text-sm">
            <p className="font-medium">{s.de ? `${STATUS_VINCULO[s.de]?.rotulo} → ` : ""}{STATUS_VINCULO[s.para]?.rotulo}</p>
            <p className="text-xs text-texto-suave">{data(s.data_efeito)}{s.motivo && ` · ${s.motivo}`}</p>
          </li>))}</ul>
      </Cartao>
      {pode("remuneracao.ler", c.loja_atual_id) && (
        <Cartao titulo="Histórico salarial">
          {h.sal.length === 0 ? <p className="text-sm text-texto-suave">Nenhum registro.</p> :
            <ul className="flex flex-col gap-3">{h.sal.map((s) => <li key={s.id} className="text-sm"><p className="font-medium">{moeda(s.salario_base)}</p><p className="text-xs text-texto-suave">desde {data(s.vigencia_inicio)} · {s.motivo}</p></li>)}</ul>}
        </Cartao>
      )}
    </div>
  );
}

/* ---------------- Linha do tempo ---------------- */
function LinhaDoTempo({ c }: { c: ColaboradorLinha }) {
  const q = useQuery({
    queryKey: ["timeline", c.id],
    queryFn: async () => falhar(await supabase.from("eventos_timeline").select("id,tipo,data_evento,titulo,descricao,sigilo,origem,registrado_em")
      .eq("colaborador_id", c.id).order("data_evento", { ascending: false }).order("registrado_em", { ascending: false })) as Evento[],
  });
  if (q.isLoading) return <Carregando />;
  if (q.error) return <EstadoErro mensagem={(q.error as Error).message} />;
  if (!q.data?.length) return <EstadoVazio titulo="Sem eventos visíveis para o seu perfil" />;
  return (
    <Cartao>
      <ol className="relative ml-2 border-l border-borda">
        {q.data.map((e) => (
          <li key={e.id} className="mb-6 ml-6 last:mb-0">
            <span className={cx("absolute -left-1.5 mt-1.5 size-3 rounded-full border-2 border-superficie", e.sigilo === "geral" ? "bg-marca" : "bg-destaque")} aria-hidden />
            <p className="text-xs text-texto-suave">{data(e.data_evento)} · registrado {dataHora(e.registrado_em)}{e.sigilo !== "geral" && ` · sigilo ${SIGILO[e.sigilo]}`}</p>
            <p className="font-medium">{e.titulo}</p>
            {e.descricao && <p className="text-sm text-texto-suave">{e.descricao}</p>}
          </li>
        ))}
      </ol>
    </Cartao>
  );
}
