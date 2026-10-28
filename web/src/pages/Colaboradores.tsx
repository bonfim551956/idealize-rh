import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileScan, Search, UserPlus } from "lucide-react";
import { chamarFuncao, supabase, mensagemErro } from "../lib/supabase";
import { falhar, useCargos, useCategorias, useLojas, type ColaboradorLinha } from "../lib/dados";
import { STATUS_VINCULO, TIPOS_VINCULO, cpfValido, data, hoje, mascaraCpf, mascaraTelefone, so_digitos } from "../lib/formato";
import { useAuth } from "../auth/AuthProvider";
import { Aviso, Botao, CabecalhoPagina, Campo, Cartao, Carregando, EstadoErro, EstadoVazio, Selecao, Selo, Tabela, useAvisos } from "../ui/componentes";

/* ---------------- Lista ---------------- */
export function Colaboradores() {
  const { pode } = useAuth();
  const lojas = useLojas();
  const [busca, setBusca] = useState("");
  const [loja, setLoja] = useState("");
  const [status, setStatus] = useState("vigentes");

  const q = useQuery({
    queryKey: ["colaboradores", loja, status],
    queryFn: async () => {
      let r = supabase.from("v_colaboradores").select("*").order("nome_completo").limit(1000);
      if (loja) r = r.eq("loja_atual_id", loja);
      if (status === "vigentes") r = r.not("status", "in", "(desligado,arquivado)");
      else if (status) r = r.eq("status", status);
      return falhar(await r) as ColaboradorLinha[];
    },
  });

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    if (!t) return q.data ?? [];
    return (q.data ?? []).filter((c) =>
      [c.nome_completo, c.nome_social, c.matricula, c.cargo_nome].some((v) =>
        (v ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").includes(t)));
  }, [q.data, busca]);

  return (
    <>
      <CabecalhoPagina titulo="Colaboradores" descricao="Equipe de todas as lojas a que você tem acesso."
        acoes={pode("colaborador.criar") && <Link to="/colaboradores/novo"><Botao icone={<UserPlus className="size-4" />}>Novo colaborador</Botao></Link>} />

      <Cartao>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="relative">
            <Campo rotulo="Buscar" placeholder="Nome, matrícula ou cargo" value={busca} onChange={(e) => setBusca(e.target.value)} className="[&_input]:pl-9" />
            <Search className="pointer-events-none absolute bottom-3 left-3 size-4 text-texto-suave" aria-hidden />
          </div>
          <Selecao rotulo="Loja" value={loja} onChange={(e) => setLoja(e.target.value)}>
            <option value="">Todas</option>
            {lojas.data?.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </Selecao>
          <Selecao rotulo="Situação" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="vigentes">Vínculos vigentes</option>
            <option value="">Todos</option>
            {Object.entries(STATUS_VINCULO).map(([k, v]) => <option key={k} value={k}>{v.rotulo}</option>)}
          </Selecao>
        </div>

        {q.isLoading && <Carregando />}
        {q.error && <EstadoErro mensagem={(q.error as Error).message} tentarNovamente={() => q.refetch()} />}
        {q.data && filtrados.length === 0 && (
          <EstadoVazio titulo={q.data.length === 0 ? "Nenhum colaborador encontrado" : "Nada encontrado com esta busca"}
            descricao={q.data.length === 0 && pode("colaborador.criar") ? "Cadastre a equipe atual para começar." : undefined} />
        )}
        {filtrados.length > 0 && (
          <>
            <Tabela cabecalho={["Nome", "Loja", "Cargo", "Matrícula", "Admissão", "Situação"]}>
              {filtrados.map((c) => (
                <tr key={c.id} className="hover:bg-fundo">
                  <td className="px-4 py-3">
                    <Link to={`/colaboradores/${c.id}`} className="font-medium text-primaria hover:underline">{c.nome_social || c.nome_completo}</Link>
                    <p className="text-xs text-texto-suave">{c.cpf_mascarado}</p>
                  </td>
                  <td className="px-4 py-3">{c.loja_nome}</td>
                  <td className="px-4 py-3">{c.cargo_nome ?? "—"}</td>
                  <td className="px-4 py-3">{c.matricula ?? "—"}</td>
                  <td className="px-4 py-3">{data(c.data_admissao)}</td>
                  <td className="px-4 py-3">{c.status && <Selo tom={STATUS_VINCULO[c.status]?.tom}>{STATUS_VINCULO[c.status]?.rotulo}</Selo>}</td>
                </tr>
              ))}
            </Tabela>
            <p className="mt-3 text-xs text-texto-suave">{filtrados.length} colaborador(es)</p>
          </>
        )}
      </Cartao>
    </>
  );
}

/* ---------------- Leitura da ficha de admissão ---------------- */
type LeituraFicha = {
  dados: Record<string, string | null>; cargo_lido: string | null; cpf_lido_invalido: boolean;
  outros_dados: string | null; legibilidade: "boa" | "parcial" | "ruim"; ja_cadastrado: { id: string; nome_completo: string } | null;
};

function FichaAdmissao({ aoLer, lendo, setLendo }: { aoLer: (r: LeituraFicha, arquivo: File) => void; lendo: boolean; setLendo: (v: boolean) => void }) {
  const avisar = useAvisos();
  const [erro, setErro] = useState<string | null>(null);
  async function ler(arquivo: File | undefined) {
    if (!arquivo) return;
    setErro(null); setLendo(true);
    try {
      const fd = new FormData(); fd.append("arquivo", arquivo);
      const r = await chamarFuncao<LeituraFicha>("admissao-ler", fd, false);
      aoLer(r, arquivo);
      avisar("sucesso", "Ficha lida. Confira os campos marcados antes de cadastrar.");
    } catch (e) { setErro(mensagemErro(e)); } finally { setLendo(false); }
  }
  return (
    <Cartao titulo="Preencher pela ficha de admissão">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-texto-suave">Envie a ficha (PDF ou foto). A leitura automática preenche o formulário abaixo; você confere e corrige antes de cadastrar. Nada é gravado sem a sua confirmação.</p>
        <label className={`inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg bg-primaria px-4 py-2 text-sm font-medium text-white hover:opacity-90 ${lendo ? "pointer-events-none opacity-60" : ""}`}>
          <FileScan className="size-4" aria-hidden />{lendo ? "Lendo a ficha…" : "Enviar ficha"}
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" disabled={lendo}
            onChange={(e) => { ler(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
      </div>
      {erro && <Aviso tom="perigo">{erro}</Aviso>}
    </Cartao>
  );
}

/* ---------------- Cadastro ---------------- */
export function NovoColaborador() {
  const { pode, lojasCom } = useAuth();
  const lojas = useLojas();
  const cargos = useCargos();
  const navegar = useNavigate();
  const qc = useQueryClient();
  const avisar = useAvisos();
  const permitidas = lojasCom("colaborador.criar");
  const lojasDisponiveis = (lojas.data ?? []).filter((l) => l.ativa && (permitidas === null || permitidas.includes(l.id)));

  const [f, setF] = useState({
    nome_completo: "", nome_social: "", cpf: "", data_nascimento: "", email: "", telefone: "",
    loja_id: "", matricula: "", tipo: "clt_prazo_indeterminado", status_inicial: "ativo", data_admissao: "",
    cargo_id: "", jornada_semanal_horas: "44", escala: "", salario_base: "",
    cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "",
  });
  const [lidos, setLidos] = useState<Set<string>>(new Set());
  const [leitura, setLeitura] = useState<LeituraFicha | null>(null);
  const [ficha, setFicha] = useState<File | null>(null);
  const [anexar, setAnexar] = useState(true);
  const [lendo, setLendo] = useState(false);
  const categorias = useCategorias();
  const marca = (k: string, dica?: string) => lidos.has(k) ? "✓ Lido da ficha — confira" : dica;
  function aplicarLeitura(r: LeituraFicha, arquivo: File) {
    const novos = new Set<string>();
    setF((s) => {
      const n = { ...s } as Record<string, string>;
      for (const [k, v] of Object.entries(r.dados)) {
        if (v == null || !(k in n)) continue;
        if (k === "loja_id" && !lojasDisponiveis.some((l) => l.id === v)) continue;
        n[k] = v; novos.add(k);
      }
      if (r.dados.data_admissao && r.dados.data_admissao > hoje()) n.status_inicial = "pre_admissao";
      return n as typeof s;
    });
    setLidos(novos); setLeitura(r); setFicha(arquivo);
  }
  const [erros, setErros] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const lojaSel = f.loja_id;
  const podeSalario = !!lojaSel && pode("remuneracao.gerir", lojaSel);

  const salvar = useMutation({
    mutationFn: async () => {
      const p: Record<string, string> = { ...f, cpf: so_digitos(f.cpf), telefone: so_digitos(f.telefone), cep: so_digitos(f.cep) };
      if (!podeSalario) delete p.salario_base;
      const { data, error } = await supabase.rpc("cadastrar_colaborador", { p });
      if (error) throw error;
      const id = data as string;
      let anexou: boolean | null = null;
      const cat = categorias.data?.find((c) => c.codigo === "admissao");
      if (ficha && anexar && cat) {
        try {
          const fd = new FormData();
          fd.append("arquivo", ficha);
          fd.append("meta", JSON.stringify({ categoria_id: cat.id, colaborador_id: id, nome: "FICHA DE ADMISSÃO", data_emissao: f.data_admissao || null }));
          await chamarFuncao("documentos-upload", fd, false);
          anexou = true;
        } catch { anexou = false; }
      }
      return { id, anexou };
    },
    onSuccess: ({ id, anexou }) => {
      qc.invalidateQueries({ queryKey: ["colaboradores"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      avisar(anexou === false ? "erro" : "sucesso", anexou === false
        ? "Colaborador cadastrado, mas a ficha não foi anexada. Envie-a em Documentos."
        : anexou ? "Colaborador cadastrado e ficha anexada aos documentos." : "Colaborador cadastrado.");
      navegar(`/colaboradores/${id}`);
    },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (f.nome_completo.trim().length < 3) er.nome_completo = "Informe o nome completo";
    if (!cpfValido(f.cpf)) er.cpf = "CPF inválido";
    if (!f.loja_id) er.loja_id = "Escolha a loja";
    if (!f.matricula.trim()) er.matricula = "Informe a matrícula";
    if (f.status_inicial === "ativo" && !f.data_admissao) er.data_admissao = "Obrigatória para colaborador já contratado";
    if (f.data_admissao && f.data_admissao > hoje() && f.status_inicial === "ativo") er.data_admissao = "Data no futuro: use pré-admissão";
    if (f.salario_base && !(Number(f.salario_base) > 0)) er.salario_base = "Valor inválido";
    setErros(er);
    if (Object.keys(er).length === 0) salvar.mutate();
  }

  if (lojas.isLoading || cargos.isLoading) return <Carregando />;
  if (lojasDisponiveis.length === 0) return <EstadoVazio titulo="Você não tem permissão para cadastrar colaboradores" />;

  return (
    <>
      <CabecalhoPagina titulo="Novo colaborador" descricao="Os dados ficam protegidos: só perfis autorizados veem CPF completo, endereço e salário." />
      <form onSubmit={enviar} className="flex flex-col gap-6" noValidate>
        <FichaAdmissao aoLer={aplicarLeitura} lendo={lendo} setLendo={setLendo} />
        {leitura && (
          <div className="flex flex-col gap-2">
            {leitura.ja_cadastrado && (
              <Aviso tom="perigo">Este CPF já está cadastrado: <Link to={`/colaboradores/${leitura.ja_cadastrado.id}`} className="font-medium underline">{leitura.ja_cadastrado.nome_completo}</Link>. Não cadastre de novo.</Aviso>
            )}
            <Aviso tom={leitura.legibilidade === "boa" ? "info" : "alerta"}>
              {lidos.size} campos preenchidos pela ficha (marcados com ✓). Confira cada um antes de cadastrar.
              {leitura.legibilidade !== "boa" && " A ficha está parcialmente ilegível: atenção redobrada."}
              {leitura.cpf_lido_invalido && " O CPF da ficha não é válido — digite-o conferindo o documento."}
              {leitura.cargo_lido && ` Cargo escrito na ficha: "${leitura.cargo_lido}" — escolha o correspondente na lista.`}
              {!f.matricula && " Informe a matrícula."}
              {leitura.outros_dados && ` Outros dados na ficha (ficam no arquivo anexado): ${leitura.outros_dados}.`}
            </Aviso>
          </div>
        )}
        <Cartao titulo="Dados pessoais">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Nome completo" value={f.nome_completo} onChange={set("nome_completo")} erro={erros.nome_completo} dica={marca("nome_completo")} obrigatorio className="sm:col-span-2" />
            <Campo rotulo="Nome social" value={f.nome_social} onChange={set("nome_social")} dica={marca("nome_social", "Somente se a pessoa utilizar")} />
            <Campo rotulo="CPF" inputMode="numeric" value={mascaraCpf(f.cpf)} onChange={set("cpf")} erro={erros.cpf} dica={marca("cpf")} obrigatorio />
            <Campo rotulo="Data de nascimento" type="date" value={f.data_nascimento} onChange={set("data_nascimento")} max={hoje()} dica={marca("data_nascimento")} />
            <Campo rotulo="Celular" inputMode="tel" value={mascaraTelefone(f.telefone)} onChange={set("telefone")} dica={marca("telefone")} />
            <Campo rotulo="E-mail" type="email" value={f.email} onChange={set("email")} dica={marca("email")} className="sm:col-span-2 [&_input]:uppercase" />
          </div>
        </Cartao>

        <Cartao titulo="Endereço">
          <div className="grid gap-4 sm:grid-cols-6">
            <Campo rotulo="CEP" inputMode="numeric" value={f.cep} onChange={set("cep")} dica={marca("cep")} className="sm:col-span-2" />
            <Campo rotulo="Logradouro" value={f.logradouro} onChange={set("logradouro")} dica={marca("logradouro")} className="sm:col-span-4" />
            <Campo rotulo="Número" value={f.numero} onChange={set("numero")} dica={marca("numero")} className="sm:col-span-2" />
            <Campo rotulo="Complemento" value={f.complemento} onChange={set("complemento")} dica={marca("complemento")} className="sm:col-span-4" />
            <Campo rotulo="Bairro" value={f.bairro} onChange={set("bairro")} dica={marca("bairro")} className="sm:col-span-2" />
            <Campo rotulo="Cidade" value={f.cidade} onChange={set("cidade")} dica={marca("cidade")} className="sm:col-span-3" />
            <Campo rotulo="UF" maxLength={2} value={f.uf} onChange={set("uf")} dica={marca("uf")} className="sm:col-span-1" />
          </div>
          <p className="mt-3 text-xs text-texto-suave">Opcional. Contato de emergência pode ser preenchido depois, na ficha do colaborador.</p>
        </Cartao>

        <Cartao titulo="Vínculo">
          <div className="grid gap-4 sm:grid-cols-2">
            <Selecao rotulo="Loja" value={f.loja_id} onChange={set("loja_id")} erro={erros.loja_id} dica={marca("loja_id")} obrigatorio>
              <option value="">Selecione</option>
              {lojasDisponiveis.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </Selecao>
            <Campo rotulo="Matrícula" value={f.matricula} onChange={set("matricula")} erro={erros.matricula} dica={marca("matricula")} obrigatorio />
            <Selecao rotulo="Tipo de vínculo" value={f.tipo} onChange={set("tipo")} dica={marca("tipo")} obrigatorio>
              {Object.entries(TIPOS_VINCULO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Selecao>
            <Selecao rotulo="Situação inicial" value={f.status_inicial} onChange={set("status_inicial")}
              dica={f.status_inicial === "ativo" ? "Para quem já trabalha na empresa (carga inicial)." : "Para quem ainda vai ser contratado."}>
              <option value="ativo">Já contratado (ativo)</option>
              <option value="pre_admissao">Pré-admissão</option>
            </Selecao>
            <Campo rotulo="Data de admissão" type="date" value={f.data_admissao} onChange={set("data_admissao")} erro={erros.data_admissao} dica={marca("data_admissao")} obrigatorio={f.status_inicial === "ativo"} />
            <Selecao rotulo="Cargo" value={f.cargo_id} onChange={set("cargo_id")} dica={marca("cargo_id")}>
              <option value="">Selecione</option>
              {cargos.data?.filter((c) => c.ativo).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </Selecao>
            <Campo rotulo="Jornada semanal (horas)" type="number" min={1} max={44} value={f.jornada_semanal_horas} onChange={set("jornada_semanal_horas")} dica={marca("jornada_semanal_horas")} />
            <Campo rotulo="Escala" placeholder="Ex.: 6x1, seg a sáb" value={f.escala} onChange={set("escala")} dica={marca("escala")} />
            {podeSalario && (
              <Campo rotulo="Salário contratual (R$)" type="number" step="0.01" min="0" value={f.salario_base} onChange={set("salario_base")} erro={erros.salario_base}
                dica={marca("salario_base", "Visível só para perfis com permissão de remuneração.")} />
            )}
          </div>
        </Cartao>

        {ficha && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={anexar} onChange={(e) => setAnexar(e.target.checked)} className="accent-[var(--color-primaria)]" />
            Anexar a ficha de admissão ({ficha.name}) aos documentos do colaborador
          </label>
        )}
        {salvar.error && <Aviso tom="perigo">{mensagemErro(salvar.error)}</Aviso>}
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundaria" onClick={() => navegar(-1)}>Cancelar</Botao>
          <Botao type="submit" carregando={salvar.isPending}>Cadastrar</Botao>
        </div>
      </form>
    </>
  );
}
