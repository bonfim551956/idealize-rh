export const STATUS_VINCULO: Record<string, { rotulo: string; tom: Tom }> = {
  pre_admissao: { rotulo: "Pré-admissão", tom: "info" },
  em_admissao: { rotulo: "Em admissão", tom: "info" },
  ativo: { rotulo: "Ativo", tom: "sucesso" },
  em_ferias: { rotulo: "Em férias", tom: "neutro" },
  afastado: { rotulo: "Afastado", tom: "alerta" },
  em_licenca: { rotulo: "Em licença", tom: "alerta" },
  em_desligamento: { rotulo: "Em desligamento", tom: "perigo" },
  desligado: { rotulo: "Desligado", tom: "neutro" },
  arquivado: { rotulo: "Arquivado", tom: "neutro" },
};

export const STATUS_DOCUMENTO: Record<string, { rotulo: string; tom: Tom }> = {
  nao_solicitado: { rotulo: "Não solicitado", tom: "neutro" },
  pendente: { rotulo: "Pendente", tom: "alerta" },
  recebido: { rotulo: "Recebido — conferir", tom: "info" },
  em_conferencia: { rotulo: "Em conferência", tom: "info" },
  aprovado: { rotulo: "Aprovado", tom: "sucesso" },
  reprovado: { rotulo: "Reprovado", tom: "perigo" },
  aguardando_assinatura: { rotulo: "Aguardando assinatura", tom: "alerta" },
  assinado: { rotulo: "Assinado", tom: "sucesso" },
  vencido: { rotulo: "Vencido", tom: "perigo" },
  arquivado: { rotulo: "Arquivado", tom: "neutro" },
};

export const TIPOS_VINCULO: Record<string, string> = {
  clt_prazo_indeterminado: "CLT — prazo indeterminado",
  clt_experiencia: "CLT — experiência",
  clt_prazo_determinado: "CLT — prazo determinado",
  estagio: "Estágio",
  aprendiz: "Aprendiz",
  temporario: "Temporário",
  pj: "PJ",
  autonomo: "Autônomo",
};

export const SIGILO: Record<string, string> = {
  geral: "Geral", pessoal: "Pessoal", contratual: "Contratual", saude: "Saúde",
  financeiro: "Financeiro", disciplinar: "Disciplinar", juridico: "Jurídico",
};

export type Tom = "neutro" | "info" | "sucesso" | "alerta" | "perigo";

export function data(d?: string | null): string {
  if (!d) return "—";
  const s = d.length === 10 ? `${d}T12:00:00` : d;
  return new Date(s).toLocaleDateString("pt-BR");
}

export function dataHora(d?: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function moeda(v?: number | string | null): string {
  if (v === null || v === undefined || v === "") return "—";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function so_digitos(s: string): string {
  return s.replace(/\D/g, "");
}

export function mascaraCpf(s: string): string {
  const d = so_digitos(s).slice(0, 11);
  return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

export function mascaraTelefone(s: string): string {
  const d = so_digitos(s).slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}

export function cpfValido(s: string): boolean {
  const c = so_digitos(s);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(c[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

export function hoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
