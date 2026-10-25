-- =====================================================================
-- IDEALIZE RH 360º — Correção: busca de colaborador por CPF
-- A busca pelo CPF completo revela o CPF (quem vê o CPF mascarado testa
-- os 1.000 candidatos possíveis). Por isso ela passa a exigir a mesma
-- permissão da leitura de dados pessoais (com MFA) e fica auditada.
-- Quem não tem a permissão simplesmente não acha ninguém pelo CPF
-- (a classificação por IA cai na busca por nome).
-- =====================================================================

create or replace function public.localizar_colaborador_por_cpf(p_cpf text)
returns table (id uuid, nome_completo text, loja_atual_id uuid, loja_nome text)
language plpgsql volatile security definer set search_path = '' as $$
begin
  for id, nome_completo, loja_atual_id, loja_nome in
    select c.id, c.nome_completo, c.loja_atual_id, l.nome
      from public.colaboradores c
      join public.lojas l on l.id = c.loja_atual_id
     where c.cpf = privado.so_digitos(p_cpf)
       and privado.pode('colaborador.ler', c.loja_atual_id)
       and privado.pode('colaborador.dados_pessoais.ler', c.loja_atual_id)
  loop
    -- cada localização é uma leitura de dado pessoal: fica na auditoria
    perform privado.registrar_evento('LOCALIZAR_POR_CPF', 'colaboradores', id::text, loja_atual_id,
      jsonb_build_object('encontrado', true));
    return next;
  end loop;
  if not found then
    -- nunca grava o CPF pesquisado; 'negado' quando nem tem a permissão em loja alguma
    perform privado.registrar_evento('LOCALIZAR_POR_CPF', 'colaboradores', null, null,
      jsonb_build_object('encontrado', false),
      case when privado.pode_em_alguma('colaborador.dados_pessoais.ler') then 'sucesso' else 'negado' end);
  end if;
  return;
end $$;
revoke all on function public.localizar_colaborador_por_cpf(text) from public, anon;
grant execute on function public.localizar_colaborador_por_cpf(text) to authenticated;
comment on function public.localizar_colaborador_por_cpf(text) is
  'Localiza colaborador pelo CPF completo. Exige colaborador.ler e colaborador.dados_pessoais.ler (MFA) na loja; cada chamada é auditada (LOCALIZAR_POR_CPF).';
