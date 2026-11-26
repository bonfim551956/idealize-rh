import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

/** Módulos que podem ser ligados/desligados (ex.: banco de horas). Sem resposta = ligado. */
export function useModulos() {
  const q = useQuery({
    queryKey: ["modulos-ativos"], staleTime: 5 * 60e3,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("modulos_ativos");
      if (error) return {} as Record<string, boolean>;
      return (data ?? {}) as Record<string, boolean>;
    },
  });
  return { carregado: q.isFetched, ativo: (codigo: string) => q.data?.[codigo] !== false };
}
