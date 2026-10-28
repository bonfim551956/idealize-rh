-- =====================================================================
-- IDEALIZE RH 360º — Pendência "Pagar férias"
-- Férias lançadas que começam nos próximos 15 dias: pagamento (salário + 1/3
-- + abono) até 2 dias antes do início (CLT art. 145); se cair em sábado ou
-- domingo, volta para a sexta. Some quando as férias começam.
-- =====================================================================
create or replace function privado.prazo_pagamento_ferias(p_inicio date)
returns date language sql immutable set search_path = '' as $$
  select case extract(isodow from p_inicio - 2)
           when 6 then p_inicio - 3
           when 7 then p_inicio - 4
           else p_inicio - 2 end;
$$;

do $do$ declare d text; bloco text; ancora text; begin
  d := pg_get_functiondef('public.painel_pendencias(uuid)'::regprocedure);
  bloco := $b$

  -- 5b) Pagar férias (até 2 dias antes do início)
  select count(*), coalesce(jsonb_agg(x) filter (where rn <= 6), '[]') into n, itens from (
    select jsonb_build_object('nome', c.nome_completo,
             'detalhe', 'férias de ' || to_char(a.data_inicio, 'DD/MM') || ' a ' || to_char(a.data_fim, 'DD/MM')
               || case when a.abono_dias > 0 then ' + ' || a.abono_dias || ' dias de abono' else '' end
               || ' · pagar até ' || to_char(privado.prazo_pagamento_ferias(a.data_inicio), 'DD/MM')
               || ' (' || (array['segunda','terça','quarta','quinta','sexta','sábado','domingo'])[extract(isodow from privado.prazo_pagamento_ferias(a.data_inicio))::int] || ')',
             'link', '/ferias') x,
           row_number() over (order by a.data_inicio) rn
      from public.ausencias a join public.colaboradores c on c.id = a.colaborador_id
     where a.tipo = 'ferias' and not a.cancelada
       and a.data_inicio > current_date and a.data_inicio <= current_date + 15
       and (p_loja is null or c.loja_atual_id = p_loja) and privado.pode('ausencia.ler', c.loja_atual_id)) s;
  if n > 0 then r := r || jsonb_build_object('chave', 'ferias_pagar', 'titulo', 'Pagar férias (até 2 dias antes do início)', 'gravidade', 'alta',
    'quantidade', n, 'link', '/ferias', 'acao', 'Ver férias', 'itens', itens); end if;$b$;
  ancora := $a$'quantidade', n, 'link', '/ferias', 'acao', 'Programar férias', 'itens', itens); end if;$a$;
  if position(ancora in d) = 0 then raise exception 'ponto de inserção não encontrado'; end if;
  if position('ferias_pagar' in d) > 0 then raise exception 'já aplicado'; end if;
  d := replace(d, ancora, ancora || bloco);
  execute d;
end $do$;
