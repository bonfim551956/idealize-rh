import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Tabs from "@radix-ui/react-tabs";
import { ArrowLeft, ArrowRightLeft, BadgeDollarSign, Eye, EyeOff, Pencil, TrendingUp, UserMinus, Workflow } from "lucide-react";
import { mensagemErro, supabase } from "../lib/supabase";
import { falhar, useCargos, useLojas, type ColaboradorLinha } from "../lib/dados";
import { SIGILO, STATUS_VINCULO, TIPOS_VINCULO, data, dataHora, hoje, mascaraCpf, mascaraTelefone, moeda, so_digitos } from "../lib/formato";
import { useAuth } from "../auth/AuthProvider";
import { AreaTexto, Aviso, Botao, Campo, Cartao, Carregando, EstadoErro, EstadoVazio, Modal, Selecao, Selo, cx, useAvisos } from "../ui/componentes";
import { ListaDocumentos } from "./Documentos";

type Evento = { id: string; tipo: string; data_evento: string; titulo: string; descricao: string | null; sigilo: string; origem: string; registrado_em: string };

export function Ficha() {
  const { id } = useParams<{ id: string }>();
  const { pode } = useAuth();
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
    { valor: "pessoais", rotulo: "Dados pessoais", visivel: pode("colaborador.dados_pessoais.ler", loja), conteudo: <DadosPessoais c={c} /> },
    { valor: "historico", rotulo: "Movimentações", visivel: true, conteudo: <Historico c={c} /> },
    { valor: "documentos", rotulo: "Documentos", visivel: true, conteudo: <ListaDocumentos colaborador={c} /> },
    { valor: "timeline", rotulo: "Linha do tempo", visivel: true, conteudo: <LinhaDoTempo c={c} /> },
  ];

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

      <Tabs.Root defaultValue="geral">
        <Tabs.List className="mb-6 flex gap-1 overflow-x-auto border-b border-borda" aria-label="Seções da ficha">
          {abas.filter((a) => a.visivel).map((a) => (
            <Tabs.Trigger key={a.valor} value={a.valor}
              className="h-10 shrink-0 border-b-2 border-transparent px-3 text-sm font-medium text-texto-suave hover:text-texto data-[state=active]:border-primaria data-[state=active]:text-primaria">
              {a.rotulo}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {abas.filter((a) => a.visivel).map((a) => <Tabs.Content key={a.valor} value={a.valor}>{a.conteudo}</Tabs.Content>)}
      </Tabs.Root>
      <p className="mt-8 text-xs text-texto-suave">Contratos, exames, jornada, férias, ocorrências, treinamentos e avaliações chegam nas próximas etapas.</p>
    </>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return <div><dt className="text-xs text-texto-suave">{rotulo}</dt><dd className="mt-0.5 text-sm">{children}</dd></div>;
}

/* ---------------- Visão geral + ações ---------------- */
function VisaoGeral({ c }: { c: ColaboradorLinha }) {
  const { pode } = useAuth();
  const loja = c.loja_atual_id;
  const [acao, setAcao] = useState<"transferir" | "status" | "cargo" | "salario" | "desligar" | "concluir" | "editar" | null>(null);
  const encerrado = c.status === "desligado" || c.status === "arquivado";

  const desligamento = useQuery({
    queryKey: ["desligamento", c.vinculo_id],
    enabled: c.status === "em_desligamento" && pode("desligamento.gerir", loja),
    queryFn: async () => falhar(await supabase.from("desligamentos").select("id,modalidade,data_comunicacao,status").eq("vinculo_id", c.vinculo_id!).maybeSingle()) as
      { id: string; modalidade: string; data_comunicacao: string; status: string } | null,
  });

  const botoes = [
    { k: "editar" as const, rotulo: "Editar dados do vínculo", icone: Pencil, ok: pode("colaborador.editar", loja) && !encerrado },
    { k: "status" as const, rotulo: "Mudar situação", icone: Workflow, ok: pode("vinculo.status.alterar", loja) && !encerrado },
    { k: "transferir" as const, rotulo: "Transferir de loja", icone: ArrowRightLeft, ok: pode("colaborador.transferir", loja) && !encerrado },
    { k: "cargo" as const, rotulo: "Promoção / mudança de função", icone: TrendingUp, ok: pode("cargo.alterar", loja) && !encerrado },
    { k: "salario" as const, rotulo: "Alteração salarial", icone: BadgeDollarSign, ok: pode("remuneracao.gerir", loja) && !encerrado },
    { k: "desligar" as const, rotulo: "Iniciar desligamento", icone: UserMinus, ok: pode("desligamento.gerir", loja) && c.status !== "em_desligamento" && !encerrado && c.status !== "pre_admissao" && c.status !== "em_admissao" },
  ].filter((b) => b.ok);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Cartao titulo="Vínculo atual" className="lg:col-span-2">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Linha rotulo="Loja">{c.loja_nome}</Linha>
          <Linha rotulo="Cargo">{c.cargo_nome ?? "—"}</Linha>
          <Linha rotulo="Tipo de vínculo">{c.tipo ? TIPOS_VINCULO[c.tipo] : "—"}</Linha>
          <Linha rotulo="Matrícula">{c.matricula ?? "—"}</Linha>
          <Linha rotulo="Admissão">{data(c.data_admissao)}</Linha>
          <Linha rotulo="Desligamento">{data(c.data_desligamento)}</Linha>
          <Linha rotulo="Jornada semanal">{c.jornada_semanal_horas ? `${c.jornada_semanal_horas} h` : "—"}</Linha>
          <Linha rotulo="Escala">{c.escala ?? "—"}</Linha>
          <Linha rotulo="CPF">{c.cpf_mascarado}</Linha>
        </dl>
        {pode("remuneracao.ler", loja) && <SalarioAtual vinculo={c.vinculo_id} />}
      </Cartao>

      <Cartao titulo="Ações">
        {c.status === "em_desligamento" && desligamento.data && (
          <div className="mb-4 flex flex-col gap-2">
            <Aviso tom="alerta">Desligamento em andamento ({desligamento.data.modalidade.replace(/_/g, " ")}) desde {data(desligamento.data.data_comunicacao)}.</Aviso>
            <Botao variante="perigo" onClick={() => setAcao("concluir")}>Concluir desligamento</Botao>
          </div>
        )}
        {botoes.length === 0 && !desligamento.data && <p className="text-sm text-texto-suave">Seu perfil não tem ações disponíveis para este colaborador.</p>}
        <div className="flex flex-col gap-2">
          {botoes.map(({ k, rotulo, icone: I }) => (
            <Botao key={k} variante="secundaria" className="justify-start" icone={<I className="size-4" />} onClick={() => setAcao(k)}>{rotulo}</Botao>
          ))}
        </div>
      </Cartao>

      {acao === "editar" && <EditarVinculo c={c} fechar={() => setAcao(null)} />}
      {acao === "status" && <MudarStatus c={c} fechar={() => setAcao(null)} />}
      {acao === "transferir" && <Transferir c={c} fechar={() => setAcao(null)} />}
      {acao === "cargo" && <MudarCargo c={c} fechar={() => setAcao(null)} />}
      {acao === "salario" && <MudarSalario c={c} fechar={() => setAcao(null)} />}
      {acao === "desligar" && <IniciarDesligamento c={c} fechar={() => setAcao(null)} />}
      {acao === "concluir" && desligamento.data && <ConcluirDesligamento c={c} id={desligamento.data.id} fechar={() => setAcao(null)} />}
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

function IniciarDesligamento({ c, fechar }: { c: ColaboradorLinha; fechar: () => void }) {
  const [f, setF] = useState({ modalidade: "", data: hoje(), obs: "" });
  const m = useMutation(useAcao(c, fechar, "Desligamento iniciado.")(() =>
    supabase.rpc("iniciar_desligamento", { p_vinculo: c.vinculo_id, p_modalidade: f.modalidade, p_data_comunicacao: f.data, p_observacoes: f.obs || null })));
  return (
    <Modal aberto aoFechar={fechar} titulo="Iniciar desligamento" descricao={c.nome_completo}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        <Aviso tom="alerta">O checklist completo (documentos rescisórios, exame demissional, devolução de equipamentos e revogação de acessos) chega na Etapa 2. Confirme as providências com a contabilidade.</Aviso>
        <Selecao rotulo="Modalidade" value={f.modalidade} onChange={(e) => setF({ ...f, modalidade: e.target.value })} obrigatorio>
          <option value="">Selecione</option>
          {MODALIDADES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Selecao>
        <Campo rotulo="Data da comunicação" type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} obrigatorio />
        <AreaTexto rotulo="Observações" value={f.obs} onChange={(e) => setF({ ...f, obs: e.target.value })} />
        <Rodape fechar={fechar} carregando={m.isPending} texto="Iniciar" desabilitado={!f.modalidade} />
      </form>
    </Modal>
  );
}

function ConcluirDesligamento({ c, id, fechar }: { c: ColaboradorLinha; id: string; fechar: () => void }) {
  const [d, setD] = useState(hoje());
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

/* ---------------- Dados pessoais ---------------- */
type Pessoais = { cpf: string; data_nascimento: string | null; email: string | null; telefone: string | null; cep: string | null; logradouro: string | null;
  numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null };

function DadosPessoais({ c }: { c: ColaboradorLinha }) {
  const { pode } = useAuth();
  const avisar = useAvisos();
  const [dados, setDados] = useState<Pessoais | null>(null);
  const [editando, setEditando] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const podeEditar = pode("colaborador.dados_pessoais.editar", c.loja_atual_id);

  async function revelar() {
    setCarregando(true);
    const { data, error } = await supabase.rpc("colaborador_dados_pessoais", { p_colaborador: c.id });
    setCarregando(false);
    if (error) return avisar("erro", mensagemErro(error));
    if (!data) return avisar("erro", "Acesso negado aos dados pessoais.");
    setDados(data as Pessoais);
  }

  if (!dados) {
    return (
      <Cartao>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <EyeOff className="size-8 text-texto-suave" aria-hidden />
          <p className="max-w-md text-sm text-texto-suave">Os dados pessoais completos ficam ocultos. Ao exibir, o acesso é registrado na auditoria com seu nome e horário.</p>
          <Botao onClick={revelar} carregando={carregando} icone={<Eye className="size-4" />}>Exibir dados pessoais</Botao>
        </div>
      </Cartao>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Cartao titulo="Dados pessoais" acao={podeEditar && <Botao tamanho="sm" variante="secundaria" icone={<Pencil className="size-4" />} onClick={() => setEditando(true)}>Editar</Botao>}>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Linha rotulo="CPF">{mascaraCpf(dados.cpf)}</Linha>
          <Linha rotulo="Nascimento">{data(dados.data_nascimento)}</Linha>
          <Linha rotulo="Celular">{dados.telefone ? mascaraTelefone(dados.telefone) : "—"}</Linha>
          <Linha rotulo="E-mail">{dados.email ?? "—"}</Linha>
          <Linha rotulo="Endereço">
            {dados.logradouro ? `${dados.logradouro}, ${dados.numero ?? "s/n"}${dados.complemento ? ` — ${dados.complemento}` : ""}` : "—"}
            {dados.bairro && <><br />{dados.bairro} · {dados.cidade}/{dados.uf}</>}
          </Linha>
          <Linha rotulo="CEP">{dados.cep ?? "—"}</Linha>
        </dl>
      </Cartao>
      <ContatosEmergencia c={c} podeEditar={podeEditar} />
      {editando && <EditarPessoais c={c} dados={dados} fechar={(novo) => { setEditando(false); if (novo) setDados(novo); }} />}
    </div>
  );
}

function EditarPessoais({ c, dados, fechar }: { c: ColaboradorLinha; dados: Pessoais; fechar: (novo?: Pessoais) => void }) {
  const avisar = useAvisos();
  const qc = useQueryClient();
  const [f, setF] = useState({ ...dados, nome_completo: c.nome_completo, nome_social: c.nome_social ?? "" } as Record<string, string | null>);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function buscarCep() {
    const cep = so_digitos(f.cep ?? "");
    if (cep.length !== 8) return;
    setBuscandoCep(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`).then((x) => x.json());
      if (!r.erro) setF((s) => ({ ...s, logradouro: r.logradouro, bairro: r.bairro, cidade: r.localidade, uf: r.uf }));
    } catch { /* preenchimento manual */ }
    setBuscandoCep(false);
  }

  const m = useMutation({
    mutationFn: async () => {
      const p = { ...f, cpf: so_digitos(f.cpf ?? ""), telefone: so_digitos(f.telefone ?? ""), cep: so_digitos(f.cep ?? "") };
      const { error } = await supabase.rpc("atualizar_dados_pessoais", { p_colaborador: c.id, p });
      if (error) throw error;
      return p;
    },
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ["colaborador"] }); avisar("sucesso", "Dados atualizados."); fechar(p as unknown as Pessoais); },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });

  return (
    <Modal aberto aoFechar={() => fechar()} titulo="Editar dados pessoais" largura="max-w-2xl">
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }} className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Nome completo" value={f.nome_completo ?? ""} onChange={set("nome_completo")} obrigatorio className="sm:col-span-2" />
        <Campo rotulo="Nome social" value={f.nome_social ?? ""} onChange={set("nome_social")} />
        <Campo rotulo="CPF" value={mascaraCpf(f.cpf ?? "")} onChange={set("cpf")} obrigatorio />
        <Campo rotulo="Nascimento" type="date" value={f.data_nascimento ?? ""} onChange={set("data_nascimento")} max={hoje()} />
        <Campo rotulo="Celular" value={mascaraTelefone(f.telefone ?? "")} onChange={set("telefone")} />
        <Campo rotulo="E-mail" type="email" value={f.email ?? ""} onChange={set("email")} className="sm:col-span-2" />
        <Campo rotulo="CEP" value={f.cep ?? ""} onChange={set("cep")} onBlur={buscarCep} dica={buscandoCep ? "Buscando endereço…" : "Preenche o endereço automaticamente"} />
        <Campo rotulo="Logradouro" value={f.logradouro ?? ""} onChange={set("logradouro")} />
        <Campo rotulo="Número" value={f.numero ?? ""} onChange={set("numero")} />
        <Campo rotulo="Complemento" value={f.complemento ?? ""} onChange={set("complemento")} />
        <Campo rotulo="Bairro" value={f.bairro ?? ""} onChange={set("bairro")} />
        <div className="grid grid-cols-3 gap-4">
          <Campo rotulo="Cidade" value={f.cidade ?? ""} onChange={set("cidade")} className="col-span-2" />
          <Campo rotulo="UF" maxLength={2} value={f.uf ?? ""} onChange={set("uf")} />
        </div>
        <div className="sm:col-span-2"><Rodape fechar={() => fechar()} carregando={m.isPending} /></div>
      </form>
    </Modal>
  );
}

function ContatosEmergencia({ c, podeEditar }: { c: ColaboradorLinha; podeEditar: boolean }) {
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
    <Cartao titulo="Contato de emergência" acao={podeEditar && !novo && <Botao tamanho="sm" variante="secundaria" onClick={() => setNovo({ nome: "", parentesco: "", telefone: "" })}>Adicionar</Botao>}>
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
