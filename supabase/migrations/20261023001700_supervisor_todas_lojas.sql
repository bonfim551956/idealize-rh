-- =====================================================================
-- IDEALIZE RH 360º — Migração 017: Supervisor com acesso a todas as lojas
-- Supervisor pode ser concedido para "todas as lojas" (padrão) ou lojas
-- específicas. Para que ele continue só ENTREGANDO e RECEBENDO uniformes,
-- o controle do estoque central (entrada, baixa, inventário, estorno)
-- passa a ter permissão própria: uniforme.estoque.
-- =====================================================================

insert into public.permissoes (codigo, modulo, descricao, exige_mfa, sensivel) values
  ('uniforme.estoque', 'uniformes', 'Controlar o estoque central de uniformes: entrada, baixa, inventário e estorno', false, false)
on conflict (codigo) do nothing;
update public.permissoes set descricao = 'Entregar uniformes aos colaboradores e registrar devoluções'
 where codigo = 'uniforme.movimentar';

insert into public.perfil_permissoes (perfil_id, permissao)
select p.id, 'uniforme.estoque' from public.perfis p
 where p.codigo in ('diretoria', 'rh_central', 'departamento_pessoal')
on conflict do nothing;

update public.perfis
   set descricao = 'Supervisiona as lojas (todas ou as escolhidas): vê a equipe, salários (só leitura) e documentos gerais, e entrega/recebe uniformes.'
 where codigo = 'supervisor';

-- Só gerente de loja exige loja definida
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
  if p_perfil_codigo = 'gerente_loja' and p_loja is null then
    raise exception 'Gerente de loja precisa de uma loja definida';
  end if;
  insert into public.usuario_atribuicoes (usuario_id, perfil_id, loja_id, concedido_por, motivo, valido_ate)
  values (p_usuario, v_perfil, p_loja, auth.uid(), p_motivo, p_valido_ate)
  returning id into v_id;
  return v_id;
end $$;

-- Movimentar: entrega/devolução = uniforme.movimentar na loja do colaborador;
-- entrada/baixa/inventário = uniforme.estoque
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
    perform privado.exigir('uniforme.estoque', null);
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

-- Estorno passa a exigir uniforme.estoque (corpo igual ao da migração 015)
create or replace function public.uniforme_estornar(p_movimento uuid, p_motivo text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_mov public.uniforme_movimentos; v_item public.uniforme_itens; v_id uuid; v_vinc uuid;
begin
  perform privado.exigir('uniforme.estoque', null);
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do estorno'; end if;
  select * into v_mov from public.uniforme_movimentos where id = p_movimento;
  if v_mov.id is null then raise exception 'Movimentação não encontrada'; end if;
  if v_mov.tipo = 'estorno' then raise exception 'Não é possível estornar um estorno'; end if;
  if exists (select 1 from public.uniforme_movimentos where estorno_de = p_movimento) then
    raise exception 'Esta movimentação já foi estornada';
  end if;
  select * into v_item from public.uniforme_itens where id = v_mov.item_id for update;
  if privado.saldo_uniforme(v_item.id) - v_mov.delta < 0 then
    raise exception 'O estorno deixaria o estoque de % % negativo', v_item.peca, v_item.tamanho;
  end if;
  if v_mov.colaborador_id is not null
     and privado.posse_uniforme(v_item.id, v_mov.colaborador_id) - v_mov.posse_delta < 0 then
    raise exception 'O colaborador já devolveu essas peças; estorne a devolução primeiro';
  end if;

  insert into public.uniforme_movimentos
    (item_id, tipo, quantidade, delta, posse_delta, colaborador_id, data_movimento, observacao, estorno_de, registrado_por_nome)
  values (v_mov.item_id, 'estorno', v_mov.quantidade, -v_mov.delta, -v_mov.posse_delta, v_mov.colaborador_id, current_date,
          trim(p_motivo), v_mov.id, (select nome from public.usuarios where id = auth.uid()))
  returning id into v_id;

  if v_mov.colaborador_id is not null then
    select v.id into v_vinc from public.vinculos v where v.colaborador_id = v_mov.colaborador_id
     order by (v.status in ('desligado','arquivado')), v.criado_em desc limit 1;
    perform privado.timeline(v_mov.colaborador_id, v_vinc, 'uniforme', current_date,
      'REGISTRO DE UNIFORME ESTORNADO',
      upper(v_mov.quantidade || ' ' || v_item.peca || ' ' || v_item.tamanho || ' (' ||
        case v_mov.tipo when 'saida' then 'ENTREGA' else 'DEVOLUÇÃO' end || ' DE ' || to_char(v_mov.data_movimento, 'DD/MM/YYYY') ||
        ') · ' || trim(p_motivo)), 'geral');
  end if;
  return v_id;
end $$;
