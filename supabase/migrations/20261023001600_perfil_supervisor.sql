-- =====================================================================
-- IDEALIZE RH 360º — Migração 016: perfil Supervisor
-- Igual ao gerente, mas para VÁRIAS lojas (uma atribuição por loja),
-- vê salários (só leitura, com MFA) e entrega/recebe uniformes dos
-- colaboradores das suas lojas. Entrada, baixa, inventário, estorno e
-- cadastro de peças continuam com quem tem acesso a todas as lojas.
-- =====================================================================

insert into public.perfis (codigo, nome, descricao, de_sistema) values
  ('supervisor', 'Supervisor', 'Supervisiona uma ou mais lojas: vê a equipe, salários (só leitura) e documentos gerais, e entrega/recebe uniformes. Conceda uma vez para cada loja.', true)
on conflict (codigo) do nothing;

insert into public.perfil_permissoes (perfil_id, permissao)
select p.id, x from public.perfis p,
  unnest(array['dashboard.ver', 'colaborador.ler', 'remuneracao.ler', 'documento.geral.ler', 'documento.geral.enviar',
               'tarefa.ler', 'tarefa.gerir', 'uniforme.ler', 'uniforme.movimentar']) x
 where p.codigo = 'supervisor'
on conflict do nothing;

-- Supervisor e gerente sempre com loja definida
create or replace function public.conceder_acesso(
  p_usuario uuid, p_perfil_codigo text, p_loja uuid default null, p_motivo text default null,
  p_valido_ate timestamptz default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_perfil uuid; v_id uuid;
begin
  if not privado.pode('acesso.gerir') then
    raise exception 'Sem permissão para conceder acessos' using errcode = '42501';
  end if;
  if p_usuario = auth.uid() then
    raise exception 'Não é permitido conceder acesso a si mesmo' using errcode = '42501';
  end if;
  select id into v_perfil from public.perfis where codigo = p_perfil_codigo;
  if v_perfil is null then raise exception 'Perfil % não existe', p_perfil_codigo; end if;
  if p_perfil_codigo in ('gerente_loja', 'supervisor') and p_loja is null then
    raise exception 'Este perfil precisa de uma loja definida (conceda uma vez para cada loja)';
  end if;
  insert into public.usuario_atribuicoes (usuario_id, perfil_id, loja_id, concedido_por, motivo, valido_ate)
  values (p_usuario, v_perfil, p_loja, auth.uid(), p_motivo, p_valido_ate)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Uniformes com escopo por loja
-- ---------------------------------------------------------------------
-- Catálogo de peças: visível para quem tem uniforme.ler em qualquer loja
drop policy uniforme_itens_ler on public.uniforme_itens;
create policy uniforme_itens_ler on public.uniforme_itens for select to authenticated
  using (privado.pode_em_alguma('uniforme.ler'));

-- Movimentações: acesso total vê tudo; por loja vê as dos colaboradores das suas lojas
drop policy uniforme_mov_ler on public.uniforme_movimentos;
create policy uniforme_mov_ler on public.uniforme_movimentos for select to authenticated
  using (privado.pode('uniforme.ler')
         or (colaborador_id is not null and privado.pode('uniforme.ler', privado.loja_do_colaborador(colaborador_id))));

-- Totais do estoque central calculados sem depender do que a pessoa enxerga
create or replace function privado.posse_total_uniforme(p_item uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(sum(posse_delta), 0)::integer from public.uniforme_movimentos where item_id = p_item;
$$;
create or replace function privado.ultima_mov_uniforme(p_item uuid)
returns date language sql stable security definer set search_path = '' as $$
  select max(data_movimento) from public.uniforme_movimentos where item_id = p_item;
$$;
revoke all on function privado.posse_total_uniforme(uuid), privado.ultima_mov_uniforme(uuid) from public, anon;
grant execute on function privado.saldo_uniforme(uuid), privado.posse_total_uniforme(uuid), privado.ultima_mov_uniforme(uuid) to authenticated;

create or replace view public.v_uniformes_estoque with (security_invoker = true) as
select i.id, i.grupo, i.peca, i.tamanho, i.estoque_minimo, i.ativo,
       privado.saldo_uniforme(i.id) as saldo,
       privado.posse_total_uniforme(i.id) as com_colaboradores,
       case when i.ativo then greatest(i.estoque_minimo - privado.saldo_uniforme(i.id), 0) else 0 end::integer as a_pedir,
       privado.ultima_mov_uniforme(i.id) as ultima_movimentacao
  from public.uniforme_itens i;

-- Movimentar: entrega/devolução exigem a permissão NA LOJA do colaborador;
-- entrada, baixa e inventário exigem acesso a todas as lojas (estoque central)
create or replace function public.uniforme_movimentar(
  p_tipo text, p_itens jsonb, p_colaborador uuid default null, p_data date default null, p_observacao text default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_data date := coalesce(p_data, current_date);
  v_obs  text := nullif(trim(coalesce(p_observacao, '')), '');
  v_nome_usuario text;
  v_vinc uuid;
  v_linha jsonb;
  v_item public.uniforme_itens;
  v_qtd integer;
  v_saldo integer;
  v_delta integer;
  v_posse integer;
  v_qtd_mov integer;
  v_n integer := 0;
  v_resumo text[] := '{}';
begin
  if p_tipo not in ('entrada','saida','devolucao','baixa','ajuste') then raise exception 'Tipo de movimentação inválido'; end if;

  if p_tipo in ('saida','devolucao') then
    if p_colaborador is null then raise exception 'Informe o colaborador'; end if;
    perform privado.exigir('uniforme.movimentar', privado.loja_do_colaborador(p_colaborador));
    perform privado.exigir('colaborador.ler', privado.loja_do_colaborador(p_colaborador));
    select v.id into v_vinc from public.vinculos v where v.colaborador_id = p_colaborador
     order by (v.status in ('desligado','arquivado')), v.criado_em desc limit 1;
  else
    perform privado.exigir('uniforme.movimentar', null);
    if p_colaborador is not null then raise exception 'Colaborador só é informado em entrega ou devolução'; end if;
  end if;

  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Informe ao menos uma peça'; end if;
  if v_data > current_date then raise exception 'A data não pode ser futura'; end if;
  if p_tipo in ('baixa','ajuste') and v_obs is null then raise exception 'Informe o motivo'; end if;

  select nome into v_nome_usuario from public.usuarios where id = auth.uid();

  for v_linha in select * from jsonb_array_elements(p_itens) loop
    v_qtd := (v_linha ->> 'quantidade')::integer;
    select * into v_item from public.uniforme_itens where id = (v_linha ->> 'item_id')::uuid for update;
    if v_item.id is null then raise exception 'Peça não encontrada'; end if;
    if not v_item.ativo and p_tipo in ('entrada','saida') then raise exception '% % está desativada', v_item.peca, v_item.tamanho; end if;
    if v_qtd is null or v_qtd < 0 or (v_qtd = 0 and p_tipo <> 'ajuste') then raise exception 'Quantidade inválida para % %', v_item.peca, v_item.tamanho; end if;

    v_saldo := privado.saldo_uniforme(v_item.id);
    v_posse := 0;
    case p_tipo
      when 'entrada' then v_delta := v_qtd;
      when 'saida' then
        if v_qtd > v_saldo then raise exception 'Estoque insuficiente de % % (tem %)', v_item.peca, v_item.tamanho, v_saldo; end if;
        v_delta := -v_qtd; v_posse := v_qtd;
      when 'devolucao' then
        if v_qtd > privado.posse_uniforme(v_item.id, p_colaborador) then
          raise exception 'O colaborador não tem % unidade(s) de % % para devolver', v_qtd, v_item.peca, v_item.tamanho;
        end if;
        v_delta := v_qtd; v_posse := -v_qtd;
      when 'baixa' then
        if v_qtd > v_saldo then raise exception 'Estoque insuficiente de % % (tem %)', v_item.peca, v_item.tamanho, v_saldo; end if;
        v_delta := -v_qtd;
      when 'ajuste' then
        v_delta := v_qtd - v_saldo;
        if v_delta = 0 then continue; end if;
    end case;
    v_qtd_mov := abs(v_delta);

    insert into public.uniforme_movimentos
      (item_id, tipo, quantidade, delta, posse_delta, colaborador_id, data_movimento, observacao, registrado_por_nome)
    values (v_item.id, p_tipo, v_qtd_mov, v_delta, v_posse, p_colaborador, v_data,
            case when p_tipo = 'ajuste' then coalesce(v_obs || ' · ', '') || 'CONTADO ' || v_qtd || ', SISTEMA ' || v_saldo else v_obs end,
            v_nome_usuario);
    v_n := v_n + 1;
    v_resumo := v_resumo || (v_qtd_mov || ' ' || v_item.peca || ' ' || v_item.tamanho);
  end loop;

  if p_colaborador is not null and v_n > 0 then
    perform privado.timeline(p_colaborador, v_vinc, 'uniforme', v_data,
      case p_tipo when 'saida' then 'UNIFORME ENTREGUE' else 'UNIFORME DEVOLVIDO' end,
      upper(array_to_string(v_resumo, ', ') || coalesce(' · ' || v_obs, '')), 'geral');
  end if;
  return v_n;
end $$;
-- (uniforme_estornar continua exigindo acesso a todas as lojas)
