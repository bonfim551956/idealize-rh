import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Banknote, Briefcase, Eye, FileText, Home, Lock, Pencil, User, Users, type LucideIcon } from "lucide-react";
import { supabase } from "../lib/supabase";
import { data, moeda, TIPOS_VINCULO } from "../lib/formato";
import type { ColaboradorLinha } from "../lib/dados";
import { useAuth } from "../auth/AuthProvider";
import { Botao, Cartao, Carregando } from "../ui/componentes";

/* PRÉVIA — Visão geral com todos os campos do "Registro de Empregado" da contabilidade */
type Dependente = { nome: string; parentesco: string | null; nascimento: string | null };
export type FichaDados = {
  // contrato
  empresa: string; cnpj: string; matricula_esocial: string | null; cargo: string | null; funcao: string | null; cbo: string | null;
  departamento: string | null; centro_custo: string | null; horario_trabalho: string | null; horario_intervalo: string | null;
  salario: number | null; salario_por: string | null; fgts_opcao: string | null; fim_experiencia_1: string | null; fim_experiencia_2: string | null;
  // pessoais
  nascimento: string | null; local_nascimento: string | null; nacionalidade: string | null; estado_civil: string | null;
  sexo: string | null; cor_raca: string | null; grau_instrucao: string | null; deficiencia: string | null; pai: string | null; mae: string | null;
  // documentos
  cpf: string | null; rg: string | null; rg_emissao: string | null; rg_orgao: string | null;
  ctps: string | null; ctps_serie: string | null; ctps_emissao: string | null; ctps_uf: string | null;
  pis: string | null; pis_cadastro: string | null; titulo: string | null; titulo_zona: string | null; titulo_secao: string | null;
  cnh: string | null; cnh_categoria: string | null; doc_militar: string | null; orgao_classe: string | null;
  // contato
  endereco: string | null; telefone_celular: string | null; telefone_residencial: string | null; email: string | null;
  emergencia: string | null;
  // família e banco
  dependentes: Dependente[]; banco: string | null; agencia: string | null; conta: string | null;
};

function Campo({ rotulo, children, largo }: { rotulo: string; children: ReactNode; largo?: boolean }) {
  return (
    <div className={largo ? "sm:col-span-2 lg:col-span-3" : undefined}>
      <dt className="text-xs text-texto-suave">{rotulo}</dt>
      <dd className="mt-0.5 text-sm break-words">{children || <span className="text-texto-suave">—</span>}</dd>
    </div>
  );
}

function Bloco({ titulo, icone: Icone, editar, children }: { titulo: string; icone: LucideIcon; editar?: boolean; children: ReactNode }) {
  return (
    <Cartao titulo={<span className="inline-flex items-center gap-2"><Icone className="size-4 text-texto-suave" aria-hidden />{titulo}</span>}
      acao={editar ? <Botao tamanho="sm" variante="secundaria" icone={<Pencil className="size-4" />}>Editar</Botao> : undefined}>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</dl>
    </Cartao>
  );
}

export function FichaCompleta({ c }: { c: ColaboradorLinha }) {
  const { pode } = useAuth();
  const loja = c.loja_atual_id;
  const podePessoais = pode("colaborador.dados_pessoais.ler", loja);
  const podeEditar = pode("colaborador.editar", loja);
  const [exibir, setExibir] = useState(false);
  const q = useQuery({
    queryKey: ["ficha-completa", c.id, exibir],
    queryFn: async () => {
      const { data: r, error } = await supabase.rpc("colaborador_ficha", { p_colaborador: c.id, p_dados_pessoais: exibir });
      if (error) throw new Error(error.message);
      return r as FichaDados;
    },
  });
  if (q.isLoading) return <Carregando />;
  const f = q.data!;

  return (
    <div className="flex flex-col gap-6">
      <Bloco titulo="Contrato" icone={Briefcase} editar={podeEditar}>
        <Campo rotulo="Empregador">{f.empresa}<span className="block text-xs text-texto-suave">CNPJ {f.cnpj}</span></Campo>
        <Campo rotulo="Loja">{c.loja_nome}</Campo>
        <Campo rotulo="Matrícula eSocial">{f.matricula_esocial}</Campo>
        <Campo rotulo="Cargo">{f.cargo}</Campo>
        <Campo rotulo="Função">{f.funcao}</Campo>
        <Campo rotulo="CBO">{f.cbo}</Campo>
        <Campo rotulo="Tipo de vínculo">{c.tipo ? TIPOS_VINCULO[c.tipo] : null}</Campo>
        <Campo rotulo="Data de admissão">{data(c.data_admissao)}</Campo>
        <Campo rotulo="Experiência">{f.fim_experiencia_1 ? <>1º período até {data(f.fim_experiencia_1)}<span className="block text-xs text-texto-suave">prorrogação até {data(f.fim_experiencia_2)}</span></> : null}</Campo>
        <Campo rotulo="Jornada semanal">{c.jornada_semanal_horas ? `${c.jornada_semanal_horas} h` : null}</Campo>
        <Campo rotulo="Horário de trabalho">{f.horario_trabalho}</Campo>
        <Campo rotulo="Intervalo">{f.horario_intervalo}</Campo>
        {pode("remuneracao.ler", loja) && <Campo rotulo="Salário">{f.salario ? `${moeda(f.salario)} por ${f.salario_por ?? "mês"}` : null}</Campo>}
        <Campo rotulo="Opção FGTS">{data(f.fgts_opcao)}</Campo>
        <Campo rotulo="Departamento / centro de custo">{[f.departamento, f.centro_custo].filter(Boolean).join(" · ")}</Campo>
      </Bloco>

      {!podePessoais ? (
        <Cartao><p className="flex items-center gap-2 text-sm text-texto-suave"><Lock className="size-4" aria-hidden />Dados pessoais, documentos, endereço, dependentes e banco ficam visíveis só para RH, DP e diretoria.</p></Cartao>
      ) : !exibir ? (
        <Cartao>
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Eye className="size-6 text-texto-suave" aria-hidden />
            <p className="max-w-md text-sm text-texto-suave">Dados pessoais, documentos, endereço, dependentes e dados bancários ficam ocultos. Ao exibir, o acesso é registrado na auditoria com seu nome e horário.</p>
            <Botao icone={<Eye className="size-4" />} onClick={() => setExibir(true)}>Exibir dados completos</Botao>
          </div>
        </Cartao>
      ) : (
        <>
          <Bloco titulo="Dados pessoais" icone={User} editar={podeEditar}>
            <Campo rotulo="Nome completo">{c.nome_completo}</Campo>
            <Campo rotulo="Nome social">{c.nome_social}</Campo>
            <Campo rotulo="Data de nascimento">{data(f.nascimento)}</Campo>
            <Campo rotulo="Local de nascimento">{f.local_nascimento}</Campo>
            <Campo rotulo="Nacionalidade">{f.nacionalidade}</Campo>
            <Campo rotulo="Estado civil">{f.estado_civil}</Campo>
            <Campo rotulo="Sexo">{f.sexo}</Campo>
            <Campo rotulo="Cor / raça">{f.cor_raca}</Campo>
            <Campo rotulo="Grau de instrução">{f.grau_instrucao}</Campo>
            <Campo rotulo="Deficiência">{f.deficiencia}</Campo>
            <Campo rotulo="Pai">{f.pai}</Campo>
            <Campo rotulo="Mãe">{f.mae}</Campo>
          </Bloco>
          <Bloco titulo="Documentos" icone={FileText} editar={podeEditar}>
            <Campo rotulo="CPF">{f.cpf}</Campo>
            <Campo rotulo="RG (identidade)">{f.rg}{(f.rg_orgao || f.rg_emissao) && <span className="block text-xs text-texto-suave">{[f.rg_orgao, f.rg_emissao && `emitido em ${data(f.rg_emissao)}`].filter(Boolean).join(" · ")}</span>}</Campo>
            <Campo rotulo="CTPS">{f.ctps && <>{f.ctps} · série {f.ctps_serie}</>}{(f.ctps_uf || f.ctps_emissao) && <span className="block text-xs text-texto-suave">{[f.ctps_uf, f.ctps_emissao && `expedida em ${data(f.ctps_emissao)}`].filter(Boolean).join(" · ")}</span>}</Campo>
            <Campo rotulo="PIS">{f.pis}{f.pis_cadastro && <span className="block text-xs text-texto-suave">cadastrado em {data(f.pis_cadastro)}</span>}</Campo>
            <Campo rotulo="Título de eleitor">{f.titulo}{(f.titulo_zona || f.titulo_secao) && <span className="block text-xs text-texto-suave">zona {f.titulo_zona} · seção {f.titulo_secao}</span>}</Campo>
            <Campo rotulo="CNH">{f.cnh && <>{f.cnh} · categoria {f.cnh_categoria}</>}</Campo>
            <Campo rotulo="Documento militar">{f.doc_militar}</Campo>
            <Campo rotulo="Inscrição em órgão de classe">{f.orgao_classe}</Campo>
          </Bloco>
          <Bloco titulo="Endereço e contatos" icone={Home} editar={podeEditar}>
            <Campo rotulo="Endereço" largo>{f.endereco}</Campo>
            <Campo rotulo="Celular">{f.telefone_celular}</Campo>
            <Campo rotulo="Telefone residencial">{f.telefone_residencial}</Campo>
            <Campo rotulo="E-mail">{f.email}</Campo>
            <Campo rotulo="Contato de emergência" largo>{f.emergencia}</Campo>
          </Bloco>
          <Bloco titulo="Dependentes / beneficiários" icone={Users} editar={podeEditar}>
            {f.dependentes.length === 0 ? <Campo rotulo="Dependentes" largo>Nenhum dependente informado</Campo>
              : f.dependentes.map((d, i) => (
                <Campo key={i} rotulo={d.parentesco ?? "Dependente"}>{d.nome}{d.nascimento && <span className="block text-xs text-texto-suave">nascimento {data(d.nascimento)}</span>}</Campo>
              ))}
          </Bloco>
          <Bloco titulo="Dados bancários" icone={Banknote} editar={podeEditar}>
            <Campo rotulo="Banco">{f.banco}</Campo>
            <Campo rotulo="Agência">{f.agencia}</Campo>
            <Campo rotulo="Conta">{f.conta}</Campo>
          </Bloco>
        </>
      )}
    </div>
  );
}
