import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CalendarClock, FileCheck2, FileWarning, ListTodo, UserMinus, UserPlus, Users } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useLojas } from "../lib/dados";
import { STATUS_VINCULO, dataHora } from "../lib/formato";
import { useAuth } from "../auth/AuthProvider";
import { Botao, CabecalhoPagina, Cartao, Carregando, EstadoErro, EstadoVazio, Selecao, Selo } from "../ui/componentes";

type Resumo = {
  colaboradores_ativos: number; por_status: Record<string, number>;
  por_loja: { loja_id: string; loja: string; ativos: number }[];
  admissoes_12m: number; desligamentos_12m: number;
  documentos_pendentes_conferencia: number; documentos_pendentes: number; documentos_aguardando_assinatura: number;
  documentos_vencendo_30d: number; documentos_vencidos: number; tarefas_abertas: number; gerado_em: string;
};

function Indicador({ rotulo, valor, icone: Icone, destaque }: { rotulo: string; valor: number; icone: typeof Users; destaque?: boolean }) {
  return (
    <div className="rounded-xl border border-borda bg-superficie p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-texto-suave">{rotulo}</p>
        <Icone className={destaque && valor > 0 ? "size-4 text-perigo" : "size-4 text-texto-suave"} aria-hidden />
      </div>
      <p className="mt-2 font-display text-3xl font-semibold">{valor.toLocaleString("pt-BR")}</p>
    </div>
  );
}

export function Painel() {
  const { nome, pode } = useAuth();
  const [loja, setLoja] = useState("");
  const lojas = useLojas();
  const q = useQuery({
    queryKey: ["dashboard", loja],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_resumo", { p_loja: loja || null });
      if (error) throw new Error(error.message);
      return data as Resumo;
    },
  });

  const primeiroNome = nome.split(" ")[0];
  const semColaboradores = q.data && Object.keys(q.data.por_status).length === 0;

  return (
    <>
      <CabecalhoPagina titulo={primeiroNome ? `Olá, ${primeiroNome}` : "Painel"}
        descricao={q.data ? `Dados reais · atualizado em ${dataHora(q.data.gerado_em)}` : undefined}
        acoes={(lojas.data?.length ?? 0) > 1 && (
          <Selecao rotulo="Loja" value={loja} onChange={(e) => setLoja(e.target.value)} className="w-56">
            <option value="">Todas as lojas</option>
            {lojas.data!.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </Selecao>
        )} />

      {q.isLoading && <Carregando />}
      {q.error && <EstadoErro mensagem={(q.error as Error).message} tentarNovamente={() => q.refetch()} />}

      {q.data && semColaboradores && (
        <Cartao>
          <EstadoVazio titulo="Nenhum colaborador cadastrado ainda"
            descricao="Os indicadores aparecem aqui assim que os colaboradores forem cadastrados. Comece pelo cadastro da equipe atual de cada loja."
            acao={pode("colaborador.criar") && <Link to="/colaboradores/novo"><Botao icone={<UserPlus className="size-4" />}>Cadastrar colaborador</Botao></Link>} />
        </Cartao>
      )}

      {q.data && !semColaboradores && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Indicador rotulo="Colaboradores ativos" valor={q.data.colaboradores_ativos} icone={Users} />
            <Indicador rotulo="Admissões (12 meses)" valor={q.data.admissoes_12m} icone={UserPlus} />
            <Indicador rotulo="Desligamentos (12 meses)" valor={q.data.desligamentos_12m} icone={UserMinus} />
            <Indicador rotulo="Tarefas abertas" valor={q.data.tarefas_abertas} icone={ListTodo} />
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Indicador rotulo="Documentos a conferir" valor={q.data.documentos_pendentes_conferencia} icone={FileCheck2} destaque />
            <Indicador rotulo="Aguardando assinatura" valor={q.data.documentos_aguardando_assinatura} icone={FileWarning} />
            <Indicador rotulo="Vencem em 30 dias" valor={q.data.documentos_vencendo_30d} icone={CalendarClock} destaque />
            <Indicador rotulo="Documentos vencidos" valor={q.data.documentos_vencidos} icone={AlertCircle} destaque />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Cartao titulo="Ativos por loja">
              <ul className="flex flex-col gap-3">
                {q.data.por_loja.map((l) => {
                  const max = Math.max(1, ...q.data!.por_loja.map((x) => x.ativos));
                  return (
                    <li key={l.loja_id}>
                      <div className="mb-1 flex justify-between text-sm"><span>{l.loja}</span><span className="font-medium">{l.ativos}</span></div>
                      <div className="h-2 rounded-full bg-fundo" aria-hidden>
                        <div className="h-2 rounded-full bg-primaria" style={{ width: `${(l.ativos / max) * 100}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Cartao>
            <Cartao titulo="Vínculos por status">
              <ul className="flex flex-wrap gap-2">
                {Object.entries(q.data.por_status).map(([s, n]) => (
                  <li key={s}><Selo tom={STATUS_VINCULO[s]?.tom}>{STATUS_VINCULO[s]?.rotulo ?? s}: {n}</Selo></li>
                ))}
              </ul>
            </Cartao>
          </div>
          <p className="text-xs text-texto-suave">
            Rotatividade, férias, afastamentos, exames e ponto entram no painel com os módulos da Etapa 2.
          </p>
        </div>
      )}
    </>
  );
}
