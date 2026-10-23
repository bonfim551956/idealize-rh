import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MailPlus, Pencil, Plus, ShieldCheck, ShieldOff, UserCog, X } from "lucide-react";
import { chamarFuncao, mensagemErro, supabase } from "../lib/supabase";
import { falhar, useCargos, useEmpresas, useLojas, type Loja } from "../lib/dados";
import { dataHora, so_digitos } from "../lib/formato";
import { useAuth } from "../auth/AuthProvider";
import { AreaTexto, Aviso, Botao, CabecalhoPagina, Campo, Cartao, Carregando, EstadoErro, EstadoVazio, Modal, Selecao, Selo, Tabela, useAvisos } from "../ui/componentes";

/* =====================================================================
   Lojas e estrutura
   ===================================================================== */
export function Lojas() {
  const lojas = useLojas();
  const cargos = useCargos();
  const qc = useQueryClient();
  const avisar = useAvisos();
  const [editando, setEditando] = useState<Partial<Loja> | null>(null);
  const [novoCargo, setNovoCargo] = useState("");

  const addCargo = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("cargos").insert({ nome: novoCargo.trim() }); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cargos"] }); setNovoCargo(""); avisar("sucesso", "Cargo criado."); },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  const alternarCargo = useMutation({
    mutationFn: async (c: { id: string; ativo: boolean }) => { const { error } = await supabase.from("cargos").update({ ativo: !c.ativo }).eq("id", c.id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cargos"] }),
    onError: (e) => avisar("erro", mensagemErro(e)),
  });

  return (
    <>
      <CabecalhoPagina titulo="Lojas e estrutura" descricao="Cadastro das unidades e cargos. Dados marcados como “a confirmar” são provisórios."
        acoes={<Botao icone={<Plus className="size-4" />} onClick={() => setEditando({ ativa: true })}>Nova loja</Botao>} />
      <div className="flex flex-col gap-6">
        <Cartao titulo="Lojas">
          {lojas.isLoading ? <Carregando /> : lojas.error ? <EstadoErro mensagem={(lojas.error as Error).message} /> : (
            <Tabela cabecalho={["Loja", "Empresa (empregador)", "Endereço", "Situação", ""]}>
              {lojas.data!.map((l) => (
                <tr key={l.id} className="hover:bg-fundo">
                  <td className="px-4 py-3"><p className="font-medium">{l.nome}</p><p className="text-xs text-texto-suave">{l.codigo}</p></td>
                  <td className="px-4 py-3"><p>{l.empresas?.razao_social}</p><p className="text-xs text-texto-suave">{formatarCnpj(l.empresas?.cnpj)}</p></td>
                  <td className="px-4 py-3">{l.endereco ?? "—"}<p className="text-xs text-texto-suave">{l.cidade}/{l.uf}{l.cep ? ` · ${l.cep}` : ""}</p></td>
                  <td className="px-4 py-3"><div className="flex flex-wrap gap-1">
                    <Selo tom={l.ativa ? "sucesso" : "neutro"}>{l.ativa ? "Ativa" : "Inativa"}</Selo>
                    {!l.dados_confirmados && <Selo tom="alerta">A confirmar</Selo>}
                  </div>{l.observacao && <p className="mt-1 text-xs text-texto-suave">{l.observacao}</p>}</td>
                  <td className="px-4 py-3 text-right"><Botao tamanho="sm" variante="fantasma" icone={<Pencil className="size-4" />} onClick={() => setEditando(l)} aria-label={`Editar ${l.nome}`} /></td>
                </tr>
              ))}
            </Tabela>
          )}
        </Cartao>

        <Cartao titulo="Cargos">
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (novoCargo.trim()) addCargo.mutate(); }} className="mb-4 flex items-end gap-2">
            <Campo rotulo="Novo cargo" value={novoCargo} onChange={(e) => setNovoCargo(e.target.value)} className="flex-1" />
            <Botao type="submit" carregando={addCargo.isPending} disabled={!novoCargo.trim()}>Adicionar</Botao>
          </form>
          <ul className="flex flex-wrap gap-2">
            {cargos.data?.map((c) => (
              <li key={c.id}>
                <button onClick={() => alternarCargo.mutate(c)} title={c.ativo ? "Clique para desativar" : "Clique para reativar"}
                  className={c.ativo ? "rounded-full border border-borda bg-superficie px-3 py-1 text-sm hover:border-perigo" : "rounded-full border border-borda bg-fundo px-3 py-1 text-sm text-texto-suave line-through hover:border-primaria"}>
                  {c.nome}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-texto-suave">Cargos não são apagados: desativar remove da lista de escolha, mas preserva o histórico.</p>
        </Cartao>
      </div>
      {editando && <EditarLoja loja={editando} fechar={() => setEditando(null)} />}
    </>
  );
}

function formatarCnpj(c?: string) {
  if (!c) return "";
  return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function EditarLoja({ loja, fechar }: { loja: Partial<Loja>; fechar: () => void }) {
  const empresas = useEmpresas();
  const qc = useQueryClient();
  const avisar = useAvisos();
  const nova = !loja.id;
  const [f, setF] = useState({
    empresa_id: loja.empresa_id ?? "", codigo: loja.codigo ?? "", nome: loja.nome ?? "", cidade: loja.cidade ?? "", uf: loja.uf ?? "SP",
    endereco: loja.endereco ?? "", cep: loja.cep ?? "", telefone: loja.telefone ?? "", ativa: loja.ativa ?? true,
    dados_confirmados: loja.dados_confirmados ?? false, observacao: loja.observacao ?? "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const m = useMutation({
    mutationFn: async () => {
      const dados = { ...f, codigo: f.codigo.toUpperCase().replace(/[^A-Z0-9_-]/g, ""), cep: so_digitos(f.cep) || null, telefone: so_digitos(f.telefone) || null,
        uf: f.uf.toUpperCase() || null, observacao: f.observacao || null };
      const r = nova ? await supabase.from("lojas").insert(dados) : await supabase.from("lojas").update(dados).eq("id", loja.id!);
      if (r.error) throw r.error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["lojas"] }); avisar("sucesso", nova ? "Loja cadastrada." : "Loja atualizada."); fechar(); },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  return (
    <Modal aberto aoFechar={fechar} titulo={nova ? "Nova loja" : `Editar ${loja.nome}`} largura="max-w-2xl">
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }} className="grid gap-4 sm:grid-cols-2">
        <Selecao rotulo="Empresa (empregador)" value={f.empresa_id} onChange={set("empresa_id")} obrigatorio className="sm:col-span-2"
          dica="Para uma loja de CNPJ novo, a empresa precisa ser cadastrada antes (peça ao suporte técnico).">
          <option value="">Selecione</option>
          {empresas.data?.map((e) => <option key={e.id} value={e.id}>{e.razao_social} · {formatarCnpj(e.cnpj)}</option>)}
        </Selecao>
        <Campo rotulo="Nome" value={f.nome} onChange={set("nome")} obrigatorio />
        <Campo rotulo="Código interno" value={f.codigo} onChange={set("codigo")} obrigatorio dica="Letras maiúsculas e números, sem espaço" />
        <Campo rotulo="Endereço" value={f.endereco} onChange={set("endereco")} className="sm:col-span-2" />
        <Campo rotulo="Cidade" value={f.cidade} onChange={set("cidade")} />
        <div className="grid grid-cols-2 gap-4">
          <Campo rotulo="UF" maxLength={2} value={f.uf} onChange={set("uf")} />
          <Campo rotulo="CEP" inputMode="numeric" value={f.cep} onChange={set("cep")} />
        </div>
        <Campo rotulo="Telefone" inputMode="tel" value={f.telefone} onChange={set("telefone")} />
        <div className="flex flex-col justify-end gap-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.ativa} onChange={(e) => setF({ ...f, ativa: e.target.checked })} /> Loja ativa</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.dados_confirmados} onChange={(e) => setF({ ...f, dados_confirmados: e.target.checked })} /> Dados conferidos</label>
        </div>
        <AreaTexto rotulo="Observação" value={f.observacao} onChange={set("observacao")} className="sm:col-span-2" />
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Botao type="button" variante="secundaria" onClick={fechar}>Cancelar</Botao>
          <Botao type="submit" carregando={m.isPending} disabled={!f.empresa_id || !f.nome.trim() || !f.codigo.trim()}>Salvar</Botao>
        </div>
      </form>
    </Modal>
  );
}

/* =====================================================================
   Usuários e acessos
   ===================================================================== */
type Usuario = { id: string; nome: string; email: string; ativo: boolean; criado_em: string };
type Atribuicao = { id: string; usuario_id: string; perfil_id: string; loja_id: string | null; concedido_em: string; valido_ate: string | null };
type Perfil = { id: string; codigo: string; nome: string; descricao: string | null };

export function Acessos() {
  const { sessao } = useAuth();
  const lojas = useLojas();
  const [convite, setConvite] = useState(false);
  const [concedendo, setConcedendo] = useState<Usuario | null>(null);
  const [revogando, setRevogando] = useState<{ a: Atribuicao; u: Usuario } | null>(null);

  const q = useQuery({
    queryKey: ["acessos"],
    queryFn: async () => {
      const [u, a, p] = await Promise.all([
        supabase.from("usuarios").select("id,nome,email,ativo,criado_em").order("nome"),
        supabase.from("usuario_atribuicoes").select("id,usuario_id,perfil_id,loja_id,concedido_em,valido_ate").eq("ativo", true),
        supabase.from("perfis").select("id,codigo,nome,descricao").order("nome"),
      ]);
      return { usuarios: falhar(u) as Usuario[], atrib: falhar(a) as Atribuicao[], perfis: falhar(p) as Perfil[] };
    },
  });

  const nomeLoja = (id: string | null) => id ? lojas.data?.find((l) => l.id === id)?.nome ?? "Loja" : "Todas as lojas";

  return (
    <>
      <CabecalhoPagina titulo="Usuários e acessos" descricao="Quem entra no sistema e o que pode ver. Toda concessão e revogação fica na auditoria."
        acoes={<Botao icone={<MailPlus className="size-4" />} onClick={() => setConvite(true)}>Convidar usuário</Botao>} />
      <Cartao>
        {q.isLoading ? <Carregando /> : q.error ? <EstadoErro mensagem={(q.error as Error).message} tentarNovamente={() => q.refetch()} /> : (
          <Tabela cabecalho={["Usuário", "Perfis e escopo", ""]}>
            {q.data!.usuarios.map((u) => {
              const minhas = q.data!.atrib.filter((a) => a.usuario_id === u.id);
              const proprio = u.id === sessao?.user.id;
              return (
                <tr key={u.id} className="align-top hover:bg-fundo">
                  <td className="px-4 py-3"><p className="font-medium">{u.nome}{proprio && <span className="text-texto-suave"> (você)</span>}</p><p className="text-xs text-texto-suave">{u.email}</p></td>
                  <td className="px-4 py-3">
                    {minhas.length === 0 ? <Selo tom="alerta">Sem acesso</Selo> : (
                      <ul className="flex flex-wrap gap-2">
                        {minhas.map((a) => (
                          <li key={a.id} className="inline-flex items-center gap-1 rounded-full border border-borda bg-superficie py-0.5 pl-3 pr-1 text-xs">
                            {q.data!.perfis.find((p) => p.id === a.perfil_id)?.nome} · {nomeLoja(a.loja_id)}
                            {!proprio && <button className="rounded-full p-1 text-texto-suave hover:bg-perigo-suave hover:text-perigo" aria-label="Revogar acesso" onClick={() => setRevogando({ a, u })}><X className="size-3" /></button>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!proprio && <Botao tamanho="sm" variante="secundaria" icone={<UserCog className="size-4" />} onClick={() => setConcedendo(u)}>Conceder acesso</Botao>}
                  </td>
                </tr>
              );
            })}
          </Tabela>
        )}
        <p className="mt-3 text-xs text-texto-suave">Ninguém concede acesso a si mesmo. Para bloquear alguém (ex.: desligamento), revogue todos os perfis.</p>
      </Cartao>
      <Convidar aberto={convite} fechar={() => setConvite(false)} />
      {concedendo && q.data && <Conceder usuario={concedendo} perfis={q.data.perfis} fechar={() => setConcedendo(null)} />}
      {revogando && <Revogar {...revogando} fechar={() => setRevogando(null)} />}
    </>
  );
}

function Convidar({ aberto, fechar }: { aberto: boolean; fechar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAvisos();
  const [f, setF] = useState({ nome: "", email: "" });
  const m = useMutation({
    mutationFn: () => chamarFuncao("usuarios-convidar", JSON.stringify(f)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["acessos"] }); avisar("sucesso", `Convite enviado para ${f.email}.`); setF({ nome: "", email: "" }); fechar(); },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  return (
    <Modal aberto={aberto} aoFechar={fechar} titulo="Convidar usuário" descricao="A pessoa recebe um e-mail para criar a senha e entra sem nenhum acesso. Depois você concede o perfil.">
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        <Campo rotulo="Nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} obrigatorio />
        <Campo rotulo="E-mail" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} obrigatorio />
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundaria" onClick={fechar}>Cancelar</Botao>
          <Botao type="submit" carregando={m.isPending} disabled={f.nome.trim().length < 2 || !f.email.includes("@")}>Enviar convite</Botao>
        </div>
      </form>
    </Modal>
  );
}

function Conceder({ usuario, perfis, fechar }: { usuario: Usuario; perfis: Perfil[]; fechar: () => void }) {
  const lojas = useLojas();
  const qc = useQueryClient();
  const avisar = useAvisos();
  const [f, setF] = useState({ perfil: "", loja: "", motivo: "", validade: "" });
  const perfil = perfis.find((p) => p.codigo === f.perfil);
  const exigeLoja = f.perfil === "gerente_loja" || f.perfil === "supervisor";
  const m = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("conceder_acesso", {
        p_usuario: usuario.id, p_perfil_codigo: f.perfil, p_loja: f.loja || null, p_motivo: f.motivo || null,
        p_valido_ate: f.validade ? `${f.validade}T23:59:59-03:00` : null,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["acessos"] }); avisar("sucesso", "Acesso concedido."); fechar(); },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  return (
    <Modal aberto aoFechar={fechar} titulo="Conceder acesso" descricao={`${usuario.nome} · ${usuario.email}`}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        <Selecao rotulo="Perfil" value={f.perfil} onChange={(e) => setF({ ...f, perfil: e.target.value })} obrigatorio>
          <option value="">Selecione</option>
          {perfis.filter((p) => p.codigo !== "colaborador").map((p) => <option key={p.id} value={p.codigo}>{p.nome}</option>)}
        </Selecao>
        {perfil?.descricao && <Aviso>{perfil.descricao}</Aviso>}
        <Selecao rotulo="Escopo" value={f.loja} onChange={(e) => setF({ ...f, loja: e.target.value })} obrigatorio={exigeLoja}
          dica={exigeLoja ? (f.perfil === "supervisor" ? "Supervisor: conceda uma vez para cada loja que ele acompanha." : "Gerente sempre fica restrito a uma loja.") : "Deixe “Todas as lojas” só para quem realmente precisa."}>
          {!exigeLoja && <option value="">Todas as lojas</option>}
          {exigeLoja && <option value="">Selecione</option>}
          {lojas.data?.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
        </Selecao>
        <Campo rotulo="Válido até (opcional)" type="date" value={f.validade} onChange={(e) => setF({ ...f, validade: e.target.value })}
          dica="Útil para jurídico ou contabilidade em um caso específico." />
        <AreaTexto rotulo="Motivo" value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} />
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundaria" onClick={fechar}>Cancelar</Botao>
          <Botao type="submit" carregando={m.isPending} disabled={!f.perfil || (exigeLoja && !f.loja)}>Conceder</Botao>
        </div>
      </form>
    </Modal>
  );
}

function Revogar({ a, u, fechar }: { a: Atribuicao; u: Usuario; fechar: () => void }) {
  const qc = useQueryClient();
  const avisar = useAvisos();
  const [motivo, setMotivo] = useState("");
  const m = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc("revogar_acesso", { p_atribuicao: a.id, p_motivo: motivo }); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["acessos"] }); avisar("sucesso", "Acesso revogado."); fechar(); },
    onError: (e) => avisar("erro", mensagemErro(e)),
  });
  return (
    <Modal aberto aoFechar={fechar} titulo="Revogar acesso" descricao={u.nome}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        <AreaTexto rotulo="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} obrigatorio />
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="secundaria" onClick={fechar}>Cancelar</Botao>
          <Botao type="submit" variante="perigo" carregando={m.isPending} disabled={!motivo.trim()}>Revogar</Botao>
        </div>
      </form>
    </Modal>
  );
}

/* =====================================================================
   Auditoria
   ===================================================================== */
type Registro = { id: number; em: string; usuario_id: string | null; acao: string; tabela: string | null; registro_id: string | null;
  resultado: string; dados_antes: Record<string, unknown> | null; dados_depois: Record<string, unknown> | null; contexto: Record<string, unknown> | null };

const TABELAS: Record<string, string> = {
  colaboradores: "Colaboradores", vinculos: "Vínculos", lotacoes: "Lotação", historico_cargos: "Cargos", remuneracoes: "Salários",
  documentos: "Documentos", documento_versoes: "Versões de documento", desligamentos: "Desligamentos", usuario_atribuicoes: "Acessos",
  usuarios: "Usuários", lojas: "Lojas", empresas: "Empresas", cargos: "Cargo (cadastro)", tarefas: "Tarefas", doc_categorias: "Categorias",
  contatos_emergencia: "Contatos de emergência", perfil_permissoes: "Permissões de perfil",
};

export function Auditoria() {
  const [filtro, setFiltro] = useState({ tabela: "", resultado: "" });
  const [aberto, setAberto] = useState<Registro | null>(null);
  const usuarios = useQuery({
    queryKey: ["usuarios-nomes"],
    queryFn: async () => falhar(await supabase.from("usuarios").select("id,nome")) as { id: string; nome: string }[],
  });
  const q = useQuery({
    queryKey: ["auditoria", filtro],
    queryFn: async () => {
      let r = supabase.from("audit_log").select("*").order("em", { ascending: false }).limit(300);
      if (filtro.tabela) r = r.eq("tabela", filtro.tabela);
      if (filtro.resultado) r = r.eq("resultado", filtro.resultado);
      return falhar(await r) as Registro[];
    },
  });
  const nomes = useMemo(() => Object.fromEntries((usuarios.data ?? []).map((u) => [u.id, u.nome])), [usuarios.data]);
  const quem = (id: string | null) => id ? nomes[id] ?? "Usuário" : "Sistema";
  const acao = (r: Registro) => ({ INSERT: "Criou", UPDATE: "Alterou", DELETE: "Excluiu", LER_DADOS_PESSOAIS: "Leu dados pessoais",
    ACESSO_DOCUMENTO: "Tentou acessar documento", UPLOAD_DOCUMENTO: "Tentou enviar documento" } as Record<string, string>)[r.acao] ?? r.acao;

  return (
    <>
      <CabecalhoPagina titulo="Auditoria" descricao="Registros imutáveis: ninguém altera nem apaga. Mostrando os 300 mais recentes do filtro." />
      <Cartao>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Selecao rotulo="Área" value={filtro.tabela} onChange={(e) => setFiltro({ ...filtro, tabela: e.target.value })}>
            <option value="">Todas</option>
            {Object.entries(TABELAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Selecao>
          <Selecao rotulo="Resultado" value={filtro.resultado} onChange={(e) => setFiltro({ ...filtro, resultado: e.target.value })}>
            <option value="">Todos</option>
            <option value="sucesso">Sucesso</option>
            <option value="negado">Acesso negado</option>
          </Selecao>
        </div>
        {q.isLoading ? <Carregando /> : q.error ? <EstadoErro mensagem={(q.error as Error).message} /> : q.data!.length === 0 ? <EstadoVazio titulo="Nenhum registro" /> : (
          <Tabela cabecalho={["Quando", "Quem", "O quê", "Área", "Resultado"]}>
            {q.data!.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-fundo" onClick={() => setAberto(r)}>
                <td className="whitespace-nowrap px-4 py-3">{dataHora(r.em)}</td>
                <td className="px-4 py-3">{quem(r.usuario_id)}</td>
                <td className="px-4 py-3">{acao(r)}</td>
                <td className="px-4 py-3">{TABELAS[r.tabela ?? ""] ?? r.tabela ?? "—"}</td>
                <td className="px-4 py-3"><Selo tom={r.resultado === "sucesso" ? "sucesso" : "perigo"}>{r.resultado === "sucesso" ? "Sucesso" : "Negado"}</Selo></td>
              </tr>
            ))}
          </Tabela>
        )}
      </Cartao>
      {aberto && (
        <Modal aberto aoFechar={() => setAberto(null)} titulo={`${acao(aberto)} · ${TABELAS[aberto.tabela ?? ""] ?? aberto.tabela ?? ""}`}
          descricao={`${dataHora(aberto.em)} · ${quem(aberto.usuario_id)}`} largura="max-w-2xl">
          <div className="grid gap-4 sm:grid-cols-2">
            {(["dados_antes", "dados_depois", "contexto"] as const).filter((k) => aberto[k]).map((k) => (
              <div key={k} className={k === "contexto" ? "sm:col-span-2" : ""}>
                <p className="mb-1 text-xs font-medium text-texto-suave">{k === "dados_antes" ? "Antes" : k === "dados_depois" ? "Depois" : "Contexto"}</p>
                <pre className="max-h-72 overflow-auto rounded-lg bg-fundo p-3 text-xs">{JSON.stringify(aberto[k], null, 2)}</pre>
              </div>
            ))}
            <p className="text-xs text-texto-suave sm:col-span-2">Registro #{aberto.id} · ID afetado: {aberto.registro_id ?? "—"}</p>
          </div>
        </Modal>
      )}
    </>
  );
}

/* =====================================================================
   Minha conta
   ===================================================================== */
export function Conta() {
  const { sessao, nome, temFatorMfa, permissoes, recarregar } = useAuth();
  const avisar = useAvisos();
  const [senha, setSenha] = useState({ nova: "", confirma: "" });
  const [salvando, setSalvando] = useState(false);
  const bloqueadas = permissoes.filter((p) => !p.liberada_na_sessao).length;

  async function trocarSenha(e: FormEvent) {
    e.preventDefault();
    if (senha.nova.length < 10 || !/[A-Za-z]/.test(senha.nova) || !/\d/.test(senha.nova)) return avisar("erro", "Use pelo menos 10 caracteres, com letras e números.");
    if (senha.nova !== senha.confirma) return avisar("erro", "As senhas não conferem.");
    setSalvando(true);
    const { error } = await supabase.auth.updateUser({ password: senha.nova });
    setSalvando(false);
    if (error) return avisar("erro", mensagemErro(error));
    setSenha({ nova: "", confirma: "" });
    avisar("sucesso", "Senha alterada.");
  }

  async function sairDeTodos() {
    await supabase.auth.signOut({ scope: "global" });
  }

  return (
    <>
      <CabecalhoPagina titulo="Minha conta" descricao={`${nome} · ${sessao?.user.email}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Cartao titulo="Verificação em duas etapas">
          <div className="flex items-start gap-3">
            {temFatorMfa ? <ShieldCheck className="size-6 text-sucesso" aria-hidden /> : <ShieldOff className="size-6 text-alerta" aria-hidden />}
            <div className="text-sm">
              <p className="font-medium">{temFatorMfa ? "Ativada" : "Não ativada"}</p>
              <p className="text-texto-suave">{temFatorMfa
                ? "Seu login exige o código do app autenticador."
                : "Perfis que acessam dados sensíveis são obrigados a ativar. Para os demais é opcional, mas recomendado."}</p>
            </div>
          </div>
          {bloqueadas > 0 && <Aviso tom="alerta">{bloqueadas} permissão(ões) do seu perfil só liberam com a verificação em duas etapas.</Aviso>}
          {!temFatorMfa && <AtivarMfa aoConcluir={recarregar} />}
        </Cartao>
        <Cartao titulo="Trocar senha">
          <form onSubmit={trocarSenha} className="flex flex-col gap-4">
            <Campo rotulo="Nova senha" type="password" autoComplete="new-password" value={senha.nova} onChange={(e) => setSenha({ ...senha, nova: e.target.value })} dica="Mínimo de 10 caracteres, com letras e números." />
            <Campo rotulo="Confirme" type="password" autoComplete="new-password" value={senha.confirma} onChange={(e) => setSenha({ ...senha, confirma: e.target.value })} />
            <Botao type="submit" carregando={salvando} disabled={!senha.nova}>Alterar senha</Botao>
          </form>
        </Cartao>
        <Cartao titulo="Sessões">
          <p className="mb-4 text-sm text-texto-suave">A sessão termina sozinha após 30 minutos sem uso. Se perdeu um aparelho, encerre todas as sessões.</p>
          <Botao variante="secundaria" onClick={sairDeTodos}>Sair de todos os dispositivos</Botao>
        </Cartao>
      </div>
    </>
  );
}

function AtivarMfa({ aoConcluir }: { aoConcluir: () => Promise<void> }) {
  const avisar = useAvisos();
  const [fator, setFator] = useState<{ id: string; qr: string; segredo: string } | null>(null);
  const [codigo, setCodigo] = useState("");
  const [carregando, setCarregando] = useState(false);

  async function iniciar() {
    setCarregando(true);
    const { data: lista } = await supabase.auth.mfa.listFactors();
    for (const f of lista?.all ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Autenticador ${Date.now()}` });
    setCarregando(false);
    if (error) return avisar("erro", mensagemErro(error));
    setFator({ id: data.id, qr: data.totp.qr_code, segredo: data.totp.secret });
  }
  async function confirmar(e: FormEvent) {
    e.preventDefault();
    setCarregando(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: fator!.id, code: codigo });
    setCarregando(false);
    if (error) return avisar("erro", "Código inválido.");
    avisar("sucesso", "Verificação em duas etapas ativada.");
    await aoConcluir();
  }

  if (!fator) return <Botao className="mt-4" onClick={iniciar} carregando={carregando}>Ativar agora</Botao>;
  return (
    <form onSubmit={confirmar} className="mt-4 flex flex-col items-center gap-3">
      <img src={fator.qr} alt="QR code para o app autenticador" className="size-44 rounded-lg border border-borda p-2" />
      <p className="break-all text-center font-mono text-xs text-texto-suave">{fator.segredo}</p>
      <Campo rotulo="Código do app" inputMode="numeric" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))} className="w-full" />
      <Botao type="submit" className="w-full" carregando={carregando} disabled={codigo.length !== 6}>Confirmar</Botao>
    </form>
  );
}
