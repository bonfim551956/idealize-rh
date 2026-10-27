import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type Loja = {
  id: string; codigo: string; nome: string; cidade: string | null; uf: string | null; endereco: string | null;
  cep: string | null; telefone: string | null; ativa: boolean; dados_confirmados: boolean; observacao: string | null;
  empresa_id: string; empresas?: { razao_social: string; cnpj: string } | null;
};
export type Cargo = { id: string; nome: string; ativo: boolean; experiencia_dias_1?: number; experiencia_dias_2?: number };
export type Categoria = { id: string; codigo: string; nome: string; nivel_sigilo: string; exige_vencimento: boolean; exige_competencia: boolean; ativa: boolean };

export type ColaboradorLinha = {
  id: string; nome_completo: string; nome_social: string | null; cpf_mascarado: string; loja_atual_id: string;
  loja_nome: string; loja_codigo: string; vinculo_id: string | null; empresa_id: string | null; matricula: string | null;
  tipo: string | null; status: string | null; data_admissao: string | null; data_desligamento: string | null;
  cargo_id: string | null; cargo_nome: string | null; jornada_semanal_horas: number | null; escala: string | null;
};

export type DocumentoLinha = {
  id: string; nome: string; categoria_id: string; categoria_nome: string; nivel_sigilo: string;
  colaborador_id: string | null; colaborador_nome: string | null; loja_id: string; loja_nome: string;
  data_emissao: string | null; data_recebimento: string | null; competencia: string | null; vencimento: string | null;
  status: string; status_assinatura: string; versao_atual: number; observacoes: string | null; criado_em: string;
};

function falhar<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export function useLojas() {
  return useQuery({
    queryKey: ["lojas"],
    queryFn: async () => falhar(await supabase.from("lojas")
      .select("id,codigo,nome,cidade,uf,endereco,cep,telefone,ativa,dados_confirmados,observacao,empresa_id,empresas(razao_social,cnpj)")
      .order("nome")) as unknown as Loja[],
  });
}

export function useCargos() {
  return useQuery({
    queryKey: ["cargos"],
    queryFn: async () => falhar(await supabase.from("cargos").select("id,nome,ativo,experiencia_dias_1,experiencia_dias_2").order("nome")) as Cargo[],
  });
}

export function useCategorias() {
  return useQuery({
    queryKey: ["categorias"],
    queryFn: async () => falhar(await supabase.from("doc_categorias")
      .select("id,codigo,nome,nivel_sigilo,exige_vencimento,exige_competencia,ativa").eq("ativa", true).order("nome")) as Categoria[],
  });
}

export function useEmpresas() {
  return useQuery({
    queryKey: ["empresas"],
    queryFn: async () => falhar(await supabase.from("empresas").select("id,cnpj,razao_social,ativa").order("razao_social")) as
      { id: string; cnpj: string; razao_social: string; ativa: boolean }[],
  });
}

export { falhar };
