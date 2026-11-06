import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Briefcase, Eye, FileText, Home, Lock, Pencil, Plus, Trash2, User, Users, type LucideIcon } from "lucide-react";
import { mensagemErro, supabase } from "../lib/supabase";
import { data, hoje, mascaraCpf, mascaraTelefone, so_digitos, TIPOS_VINCULO } from "../lib/formato";
import type { ColaboradorLinha } from "../lib/dados";
import { useAuth } from "../auth/AuthProvider";
import { Botao, Campo, Cartao, Carregando, EstadoErro, Modal, useAvisos } from "../ui/componentes";

/* Visão geral com todos os campos do "Registro de Empregado" da contabilidade */
type Dependente = { id?: string; nome: string; parentesco: string | null; data_nascimento: string | null };
type Ficha = Record<string, string | null> & { completo: boolean; dependentes?: Dependente[] };
type Bloco = "contrato" | "pessoais" | "documentos" | "contato" | "banco";
type Def = { k: string; rotulo: string; tipo?: "date" | "text" | "tel" | "email"; largo?: boolean };

const CAMPOS: Record<Bloco, Def[]> = {
  contrato: [
    { k: "funcao", rotulo: "Função" }, { k: "cbo", rotulo: "CBO" },
    { k: "jornada_semanal_horas", rotulo: "Jornada semanal (horas)" }, { k: "escala", rotulo: "Horário de trabalho" },
    { k: "horario_intervalo", rotulo: "Intervalo" }, { k: "fgts_opcao", rotulo: "Opção FGTS", tipo: "date" },
    { k: "departamento_texto", rotulo: "Departamento" }, { k: "centro_custo", rotulo: "Centro de custo" },
  ],
  pessoais: [
    { k: "nome_completo", rotulo: "Nome completo", largo: true }, { k: "nome_social", rotulo: "Nome social" },
    { k: "data_nascimento", rotulo: "Data de nascimento", tipo: "date" }, { k: "local_nascimento", rotulo: "Local de nascimento" },
    { k: "nacionalidade", rotulo: "Nacionalidade" }, { k: "estado_civil", rotulo: "Estado civil" }, { k: "sexo", rotulo: "Sexo" },
    { k: "cor_raca", rotulo: "Cor / raça" }, { k: "grau_instrucao", rotulo: "Grau de instrução" }, { k: "deficiencia", rotulo: "Deficiência" },
    { k: "nome_pai", rotulo: "Pai" }, { k: "nome_mae", rotulo: "Mãe" },
  ],
  documentos: [
    { k: "cpf", rotulo: "CPF" }, { k: "rg", rotulo: "RG (identidade)" }, { k: "rg_orgao", rotulo: "Órgão / UF emissor do RG" },
    { k: "rg_emissao", rotulo: "Emissão do RG", tipo: "date" }, { k: "ctps", rotulo: "CTPS" }, { k: "ctps_serie", rotulo: "Série da CTPS" },
    { k: "ctps_uf", rotulo: "UF da CTPS" }, { k: "ctps_emissao", rotulo: "Expedição da CTPS", tipo: "date" }, { k: "pis", rotulo: "PIS" },
    { k: "pis_cadastro", rotulo: "Cadastro do PIS", tipo: "date" }, { k: "titulo_eleitor", rotulo: "Título de eleitor" },
    { k: "titulo_zona", rotulo: "Zona" }, { k: "titulo_secao", rotulo: "Seção" }, { k: "cnh", rotulo: "CNH" },
    { k: "cnh_categoria", rotulo: "Categoria da CNH" }, { k: "doc_militar", rotulo: "Documento militar" },
    { k: "orgao_classe", rotulo: "Inscrição em órgão de classe" },
  ],
  contato: [
    { k: "cep", rotulo: "CEP" }, { k: "logradouro", rotulo: "Logradouro", largo: true }, { k: "numero", rotulo: "Número" },
    { k: "complemento", rotulo: "Complemento" }, { k: "bairro", rotulo: "Bairro" }, { k: "cidade", rotulo: "Cidade" },
    { k: "uf", rotulo: "UF" }, { k: "telefone", rotulo: "Celular", tipo: "tel" },
    { k: "telefone_residencial", rotulo: "Telefone residencial", tipo: "tel" }, { k: "email", rotulo: "E-mail", tipo: "email", largo: true },
  ],
  banco: [{ k: "banco", rotulo: "Banco" }, { k: "agencia", rotulo: "Agência" }, { k: "conta", rotulo: "Conta" }],
};
const TITULOS: Record<Bloco, string> = {
  contrato: "Contrato", pessoais: "Dados pessoais", documentos: "Documentos", contato: "Endereço e contatos", banco: "Dados bancários",
};

function Info({ rotulo, children, largo }: { rotulo: string; children: ReactNode; largo?: boolean }) {
  return (
    <div className={largo ? "sm:col-span-2 lg:col-span-3" : undefined}>
      <dt className="text-xs text-texto-suave">{rotulo}</dt>
      <dd className="mt-0.5 text-sm break-words">{children || <span className="text-texto-suave">—</span>}</dd>
    </div>
  );
}
const sub = (t: ReactNode) => <span className="block text-xs text-texto-suave">{t}</span>;

function Bloco({ titulo, icone: Icone, onEditar, children, extra }: { titulo: string; icone: LucideIcon; onEditar?: () => void; children: ReactNode; extra?: ReactNode }) {
  return (
    <Cartao titulo={<span className="inline-flex items-center gap-2"><Icone className="size-4 text-texto-suave" aria-hidden />{titulo}</span>}
      acao={onEditar ? <Botao tamanho="sm" variante="secundaria" icone={<Pencil className="size-4" />} onClick={onEditar}>Editar</Botao> : undefined}>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</dl>
      {extra}
    </Cartao>
  );
}

function EditarBloco({ c, bloco, valores, fechar }: { c: ColaboradorLinha; bloco: Bloco; valores: Record<string, unknown>; fechar: () => void }) {
  const qc = useQueryClient(); const avisar = useAvisos();
  const inicial = Object.fromEntries(CAMPOS[bloco].map((d) => [d.k, valores[d.k] == null ? "" : String(valores[d.k])])) as Record<string, string>;
  const [f, setF] = useState(inicial);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  async function buscarCep() {
    const cep = so_digitos(f.cep ?? "");
    if (cep.length !== 8) return;
    setBuscandoCep(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`).then((x) => x.json());
      if (!r.erro) setF((s) => ({ ...s, logradouro: r.logradouro || s.logradouro, bairro: r.bairro || s.bairro, cidade: r.localidade, uf: r.uf }));
    } catch { /* preenchimento manual */ }
    setBuscandoCep(false);
  }
  const m = useMutation({
    mutationFn: async () => {
      const p: Record<string, string> = {};
      for (const d of CAMPOS[bloco]) {
        if ((f[d.k] ?? "") === (inicial[d.k] ?? "")) continue;
        p[d.k] = ["cpf", "telefone", "telefone_residencial", "cep"].includes(d.k) ? so_digitos(f[d.k]) : f[d.k];
      }
      if (Object.keys(p).length === 0) return;
      const { error } = await supabase.rpc("colaborador_ficha_salvar", { p_colaborador: c.id, p_bloco: bloco, p });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ficha-completa", c.id] }); qc.invalidateQueries({ queryKey: ["colaborador"] });
      avisar("sucesso", "Dados atualizados."); fechar();
    },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  const valor = (d: Def) => d.k === "cpf" ? mascaraCpf(f[d.k] ?? "") : d.tipo === "tel" ? mascaraTelefone(f[d.k] ?? "") : f[d.k] ?? "";
  return (
    <Modal aberto aoFechar={fechar} titulo={`Editar ${TITULOS[bloco].toLowerCase()}`} descricao={c.nome_completo} largura="max-w-2xl">
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }} className="grid gap-4 sm:grid-cols-2">
        {CAMPOS[bloco].map((d) => (
          <Campo key={d.k} rotulo={d.rotulo} type={d.tipo === "date" ? "date" : d.tipo === "email" ? "email" : "text"}
            inputMode={d.tipo === "tel" || d.k === "cep" || d.k === "cpf" ? "numeric" : undefined}
            max={d.tipo === "date" ? hoje() : undefined} maxLength={d.k === "uf" || d.k === "ctps_uf" ? 2 : 200}
            value={valor(d)} onChange={set(d.k)} obrigatorio={d.k === "nome_completo" || d.k === "cpf"}
            onBlur={d.k === "cep" ? buscarCep : undefined} dica={d.k === "cep" ? (buscandoCep ? "Buscando endereço…" : "Preenche o endereço automaticamente") : undefined}
            className={d.largo ? "sm:col-span-2" : undefined} />
        ))}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Botao type="button" variante="secundaria" onClick={fechar}>Cancelar</Botao>
          <Botao type="submit" carregando={m.isPending}>Salvar</Botao>
        </div>
      </form>
    </Modal>
  );
}

function EditarDependentes({ c, lista, fechar }: { c: ColaboradorLinha; lista: Dependente[]; fechar: () => void }) {
  const qc = useQueryClient(); const avisar = useAvisos();
  const [deps, setDeps] = useState<Dependente[]>(lista.length ? lista.map((d) => ({ ...d })) : [{ nome: "", parentesco: "", data_nascimento: "" }]);
  const muda = (i: number, k: keyof Dependente, v: string) => setDeps((s) => s.map((d, j) => (j === i ? { ...d, [k]: v } : d)));
  const m = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("colaborador_ficha_salvar", { p_colaborador: c.id, p_bloco: "dependentes",
        p: { dependentes: deps.filter((d) => d.nome.trim()).map((d) => ({ nome: d.nome, parentesco: d.parentesco, data_nascimento: d.data_nascimento || null })) } });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ficha-completa", c.id] }); avisar("sucesso", "Dependentes atualizados."); fechar(); },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  return (
    <Modal aberto aoFechar={fechar} titulo="Editar dependentes / beneficiários" descricao={c.nome_completo} largura="max-w-2xl">
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        {deps.map((d, i) => (
          <div key={i} className="grid items-end gap-3 rounded-lg border border-borda p-3 sm:grid-cols-[1fr_10rem_10rem_auto]">
            <Campo rotulo="Nome" value={d.nome} onChange={(e) => muda(i, "nome", e.target.value)} />
            <Campo rotulo="Parentesco" value={d.parentesco ?? ""} onChange={(e) => muda(i, "parentesco", e.target.value)} placeholder="Ex.: filho(a)" />
            <Campo rotulo="Nascimento" type="date" max={hoje()} value={d.data_nascimento ?? ""} onChange={(e) => muda(i, "data_nascimento", e.target.value)} />
            <Botao type="button" variante="fantasma" aria-label="Remover" icone={<Trash2 className="size-4" />} onClick={() => setDeps((s) => s.filter((_, j) => j !== i))} />
          </div>
        ))}
        <Botao type="button" variante="secundaria" icone={<Plus className="size-4" />} onClick={() => setDeps((s) => [...s, { nome: "", parentesco: "", data_nascimento: "" }])}>Adicionar</Botao>
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundaria" onClick={fechar}>Cancelar</Botao>
          <Botao type="submit" carregando={m.isPending}>Salvar</Botao>
        </div>
      </form>
    </Modal>
  );
}

export function FichaCompleta({ c, salario, contatos }: { c: ColaboradorLinha; salario: ReactNode; contatos: ReactNode }) {
  const { pode } = useAuth();
  const loja = c.loja_atual_id;
  const podePessoais = pode("colaborador.dados_pessoais.ler", loja);
  const podeEditarPessoais = pode("colaborador.dados_pessoais.editar", loja);
  const podeEditarContrato = pode("colaborador.editar", loja) && c.status !== "desligado" && c.status !== "arquivado";
  const [exibir, setExibir] = useState(false);
  const [editando, setEditando] = useState<Bloco | "dependentes" | null>(null);
  const q = useQuery({
    queryKey: ["ficha-completa", c.id, exibir],
    queryFn: async () => {
      const { data: r, error } = await supabase.rpc("colaborador_ficha", { p_colaborador: c.id, p_completo: exibir });
      if (error) throw new Error(error.message);
      return r as Ficha;
    },
  });
  if (q.isLoading) return <Carregando />;
  if (q.error) return <EstadoErro mensagem={(q.error as Error).message} tentarNovamente={() => q.refetch()} />;
  const f = q.data!;
  const valoresContrato = { ...f, departamento_texto: f.departamento, jornada_semanal_horas: c.jornada_semanal_horas != null ? String(c.jornada_semanal_horas) : null, escala: c.escala };
  const valoresPessoais = { ...f, nome_completo: c.nome_completo, nome_social: c.nome_social };
  const cnpj = f.cnpj ? f.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : null;

  return (
    <div className="flex flex-col gap-6">
      <Bloco titulo="Contrato" icone={Briefcase} onEditar={podeEditarContrato ? () => setEditando("contrato") : undefined} extra={salario}>
        <Info rotulo="Empregador">{f.empresa}{cnpj && sub(`CNPJ ${cnpj}`)}</Info>
        <Info rotulo="Loja">{c.loja_nome}</Info>
        <Info rotulo="Matrícula">{c.matricula}</Info>
        <Info rotulo="Cargo">{c.cargo_nome}</Info>
        <Info rotulo="Função">{f.funcao}</Info>
        <Info rotulo="CBO">{f.cbo}</Info>
        <Info rotulo="Tipo de vínculo">{c.tipo ? TIPOS_VINCULO[c.tipo] : null}</Info>
        <Info rotulo="Data de admissão">{c.data_admissao ? data(c.data_admissao) : null}</Info>
        <Info rotulo="Experiência">{f.fim_experiencia_1 ? <>1º período até {data(f.fim_experiencia_1)}{sub(`prorrogação até ${data(f.fim_experiencia_2)}`)}</> : null}</Info>
        <Info rotulo="Jornada semanal">{c.jornada_semanal_horas ? `${c.jornada_semanal_horas} h` : null}</Info>
        <Info rotulo="Horário de trabalho">{c.escala}</Info>
        <Info rotulo="Intervalo">{f.horario_intervalo}</Info>
        <Info rotulo="Opção FGTS">{f.fgts_opcao ? data(f.fgts_opcao) : null}</Info>
        <Info rotulo="Departamento / centro de custo">{[f.departamento, f.centro_custo].filter(Boolean).join(" · ")}</Info>
        {c.data_desligamento && <Info rotulo="Desligamento">{data(c.data_desligamento)}</Info>}
      </Bloco>

      {!podePessoais ? (
        <Cartao><p className="flex items-center gap-2 text-sm text-texto-suave"><Lock className="size-4 shrink-0" aria-hidden />Dados pessoais, documentos, endereço, dependentes e banco ficam visíveis só para RH, DP e diretoria.</p></Cartao>
      ) : !f.completo ? (
        <Cartao>
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Eye className="size-6 text-texto-suave" aria-hidden />
            <p className="max-w-md text-sm text-texto-suave">Dados pessoais, documentos, endereço, dependentes e dados bancários ficam ocultos. Ao exibir, o acesso é registrado na auditoria com seu nome e horário.</p>
            <Botao icone={<Eye className="size-4" />} carregando={exibir && q.isFetching} onClick={() => setExibir(true)}>Exibir dados completos</Botao>
          </div>
        </Cartao>
      ) : (
        <>
          <Bloco titulo="Dados pessoais" icone={User} onEditar={podeEditarPessoais ? () => setEditando("pessoais") : undefined}>
            <Info rotulo="Nome completo">{c.nome_completo}</Info>
            <Info rotulo="Nome social">{c.nome_social}</Info>
            <Info rotulo="Data de nascimento">{f.data_nascimento ? data(f.data_nascimento) : null}</Info>
            <Info rotulo="Local de nascimento">{f.local_nascimento}</Info>
            <Info rotulo="Nacionalidade">{f.nacionalidade}</Info>
            <Info rotulo="Estado civil">{f.estado_civil}</Info>
            <Info rotulo="Sexo">{f.sexo}</Info>
            <Info rotulo="Cor / raça">{f.cor_raca}</Info>
            <Info rotulo="Grau de instrução">{f.grau_instrucao}</Info>
            <Info rotulo="Deficiência">{f.deficiencia}</Info>
            <Info rotulo="Pai">{f.nome_pai}</Info>
            <Info rotulo="Mãe">{f.nome_mae}</Info>
          </Bloco>
          <Bloco titulo="Documentos" icone={FileText} onEditar={podeEditarPessoais ? () => setEditando("documentos") : undefined}>
            <Info rotulo="CPF">{f.cpf ? mascaraCpf(f.cpf) : null}</Info>
            <Info rotulo="RG (identidade)">{f.rg}{(f.rg_orgao || f.rg_emissao) && sub([f.rg_orgao, f.rg_emissao && `emitido em ${data(f.rg_emissao)}`].filter(Boolean).join(" · "))}</Info>
            <Info rotulo="CTPS">{f.ctps && <>{f.ctps}{f.ctps_serie && ` · série ${f.ctps_serie}`}</>}{(f.ctps_uf || f.ctps_emissao) && sub([f.ctps_uf, f.ctps_emissao && `expedida em ${data(f.ctps_emissao)}`].filter(Boolean).join(" · "))}</Info>
            <Info rotulo="PIS">{f.pis}{f.pis_cadastro && sub(`cadastrado em ${data(f.pis_cadastro)}`)}</Info>
            <Info rotulo="Título de eleitor">{f.titulo_eleitor}{(f.titulo_zona || f.titulo_secao) && sub(`zona ${f.titulo_zona ?? "—"} · seção ${f.titulo_secao ?? "—"}`)}</Info>
            <Info rotulo="CNH">{f.cnh && <>{f.cnh}{f.cnh_categoria && ` · categoria ${f.cnh_categoria}`}</>}</Info>
            <Info rotulo="Documento militar">{f.doc_militar}</Info>
            <Info rotulo="Inscrição em órgão de classe">{f.orgao_classe}</Info>
          </Bloco>
          <Bloco titulo="Endereço e contatos" icone={Home} onEditar={podeEditarPessoais ? () => setEditando("contato") : undefined}
            extra={<div className="mt-6">{contatos}</div>}>
            <Info rotulo="Endereço" largo>{f.logradouro ? <>{f.logradouro}, {f.numero ?? "s/n"}{f.complemento && ` — ${f.complemento}`}{sub(`${[f.bairro, f.cidade && `${f.cidade}/${f.uf ?? ""}`].filter(Boolean).join(" · ")}${f.cep ? ` · CEP ${f.cep.replace(/^(\d{5})(\d{3})$/, "$1-$2")}` : ""}`)}</> : null}</Info>
            <Info rotulo="Celular">{f.telefone ? mascaraTelefone(f.telefone) : null}</Info>
            <Info rotulo="Telefone residencial">{f.telefone_residencial ? mascaraTelefone(f.telefone_residencial) : null}</Info>
            <Info rotulo="E-mail">{f.email?.toLowerCase()}</Info>
          </Bloco>
          <Bloco titulo="Dependentes / beneficiários" icone={Users} onEditar={podeEditarPessoais ? () => setEditando("dependentes") : undefined}>
            {(f.dependentes ?? []).length === 0 ? <Info rotulo="Dependentes" largo>Nenhum dependente informado</Info>
              : f.dependentes!.map((d) => (
                <Info key={d.id ?? d.nome} rotulo={d.parentesco ?? "Beneficiário(a)"}>{d.nome}{d.data_nascimento && sub(`nascimento ${data(d.data_nascimento)}`)}</Info>
              ))}
          </Bloco>
          <Bloco titulo="Dados bancários" icone={Banknote} onEditar={podeEditarPessoais ? () => setEditando("banco") : undefined}>
            <Info rotulo="Banco">{f.banco}</Info>
            <Info rotulo="Agência">{f.agencia}</Info>
            <Info rotulo="Conta">{f.conta}</Info>
          </Bloco>
        </>
      )}

      {editando === "dependentes" && <EditarDependentes c={c} lista={f.dependentes ?? []} fechar={() => setEditando(null)} />}
      {editando && editando !== "dependentes" && (
        <EditarBloco c={c} bloco={editando} fechar={() => setEditando(null)}
          valores={editando === "contrato" ? valoresContrato : editando === "pessoais" ? valoresPessoais : f} />
      )}
    </div>
  );
}
