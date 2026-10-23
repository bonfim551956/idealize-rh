-- =====================================================================
-- IDEALIZE RH 360º — Migração 015: controle de uniformes
-- Estoque CENTRAL (um só). Cada peça+tamanho é um item com estoque mínimo
-- próprio (padrão 12, ajustável na plataforma).
-- O saldo NUNCA é digitado: é a soma das movimentações (livro-razão).
-- Movimentações são imutáveis; erro se corrige com ESTORNO (fica registrado).
-- Entrega e devolução ficam atreladas ao colaborador (quantidade e data)
-- e aparecem na linha do tempo dele.
-- =====================================================================

create table public.uniforme_itens (
  id              uuid primary key default gen_random_uuid(),
  grupo           text not null check (length(trim(grupo)) > 1),
  peca            text not null check (length(trim(peca)) > 1),
  tamanho         text not null check (length(trim(tamanho)) > 0),
  estoque_minimo  integer not null default 12 check (estoque_minimo between 0 and 10000),
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create unique index uniforme_itens_unico on public.uniforme_itens (grupo, peca, tamanho);

create table public.uniforme_movimentos (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid not null references public.uniforme_itens(id) on delete restrict,
  tipo             text not null check (tipo in ('entrada','saida','devolucao','baixa','ajuste','estorno')),
  quantidade       integer not null check (quantidade > 0),
  delta            integer not null,              -- efeito no saldo do estoque
  posse_delta      integer not null default 0,    -- efeito no que o colaborador tem em mãos
  colaborador_id   uuid references public.colaboradores(id) on delete restrict,
  data_movimento   date not null,
  observacao       text,
  estorno_de       uuid unique references public.uniforme_movimentos(id) on delete restrict,
  registrado_por   uuid references public.usuarios(id) default auth.uid(),
  registrado_por_nome text,
  registrado_em    timestamptz not null default now(),
  check (tipo not in ('saida','devolucao') or colaborador_id is not null),
  check ((tipo = 'estorno') = (estorno_de is not null))
);
create index on public.uniforme_movimentos (item_id, data_movimento);
create index on public.uniforme_movimentos (colaborador_id) where colaborador_id is not null;

create trigger uniforme_itens_atualizado before update on public.uniforme_itens
  for each row execute function privado.tocar_atualizado_em();

-- regra de ouro: maiúsculas
create trigger a_maiusculas before insert or update on public.uniforme_itens
  for each row execute function privado.maiusculas('grupo', 'peca', 'tamanho');
create trigger a_maiusculas before insert or update on public.uniforme_movimentos
  for each row execute function privado.maiusculas('observacao', 'registrado_por_nome');

-- auditoria
create trigger auditar after insert or update or delete on public.uniforme_itens
  for each row execute function privado.auditar();
create trigger auditar after insert or update or delete on public.uniforme_movimentos
  for each row execute function privado.auditar();

-- movimentação é imutável
create or replace function privado.travar_movimento_uniforme()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Movimentações de uniforme não podem ser alteradas nem apagadas. Use o estorno.'
    using errcode = '42501';
end $$;
create trigger travar before update or delete on public.uniforme_movimentos
  for each row execute function privado.travar_movimento_uniforme();

-- ---------------------------------------------------------------------
-- Permissões (recurso global: o estoque é central)
-- ---------------------------------------------------------------------
insert into public.permissoes (codigo, modulo, descricao, exige_mfa, sensivel) values
  ('uniforme.ler',        'uniformes', 'Ver estoque de uniformes, pedidos e entregas', false, false),
  ('uniforme.movimentar', 'uniformes', 'Registrar entrada, entrega, devolução, baixa e inventário de uniformes', false, false),
  ('uniforme.gerir',      'uniformes', 'Cadastrar peças/tamanhos e ajustar o estoque mínimo', false, false)
on conflict (codigo) do nothing;

insert into public.perfil_permissoes (perfil_id, permissao)
select p.id, x from public.perfis p,
  unnest(array['uniforme.ler', 'uniforme.movimentar', 'uniforme.gerir']) x
 where p.codigo in ('diretoria', 'rh_central', 'departamento_pessoal')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- RLS: leitura por permissão; escrita só pelas funções abaixo
-- ---------------------------------------------------------------------
alter table public.uniforme_itens      enable row level security;
alter table public.uniforme_movimentos enable row level security;

create policy uniforme_itens_ler on public.uniforme_itens for select to authenticated
  using (privado.pode('uniforme.ler'));
create policy uniforme_mov_ler on public.uniforme_movimentos for select to authenticated
  using (privado.pode('uniforme.ler'));
revoke insert, update, delete, truncate on public.uniforme_itens, public.uniforme_movimentos from anon, authenticated;

-- ---------------------------------------------------------------------
-- Funções
-- ---------------------------------------------------------------------
create or replace function privado.saldo_uniforme(p_item uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(sum(delta), 0)::integer from public.uniforme_movimentos where item_id = p_item;
$$;

create or replace function privado.posse_uniforme(p_item uuid, p_colaborador uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(sum(posse_delta), 0)::integer from public.uniforme_movimentos
   where item_id = p_item and colaborador_id = p_colaborador;
$$;

-- Cadastra ou edita uma peça/tamanho (inclui o estoque mínimo)
create or replace function public.uniforme_item_salvar(
  p_id uuid, p_grupo text, p_peca text, p_tamanho text, p_estoque_minimo integer, p_ativo boolean default true)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform privado.exigir('uniforme.gerir', null);
  if coalesce(trim(p_grupo), '') = '' or coalesce(trim(p_peca), '') = '' or coalesce(trim(p_tamanho), '') = '' then
    raise exception 'Informe grupo, peça e tamanho';
  end if;
  if p_estoque_minimo is null or p_estoque_minimo < 0 then raise exception 'Estoque mínimo inválido'; end if;
  if exists (select 1 from public.uniforme_itens
              where grupo = upper(trim(p_grupo)) and peca = upper(trim(p_peca)) and tamanho = upper(trim(p_tamanho))
                and id is distinct from p_id) then
    raise exception 'Esta peça já está cadastrada nesse tamanho';
  end if;
  if p_id is null then
    insert into public.uniforme_itens (grupo, peca, tamanho, estoque_minimo, ativo)
    values (trim(p_grupo), trim(p_peca), trim(p_tamanho), p_estoque_minimo, coalesce(p_ativo, true))
    returning id into v_id;
  else
    update public.uniforme_itens
       set grupo = trim(p_grupo), peca = trim(p_peca), tamanho = trim(p_tamanho),
           estoque_minimo = p_estoque_minimo, ativo = coalesce(p_ativo, true)
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Peça não encontrada'; end if;
  end if;
  return v_id;
end $$;

-- Registra uma movimentação com uma ou várias peças de uma vez.
-- p_itens: [{"item_id": "...", "quantidade": 2}, ...]
--   entrada   = chegou peça no estoque (compra/recebimento)       saldo +
--   saida     = entregue ao colaborador                           saldo −  posse +
--   devolucao = colaborador devolveu (volta ao estoque)           saldo +  posse −
--   baixa     = descarte/perda/dano                               saldo −
--   ajuste    = inventário: "quantidade" é o saldo CONTADO; o sistema lança a diferença
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
  perform privado.exigir('uniforme.movimentar', null);
  if p_tipo not in ('entrada','saida','devolucao','baixa','ajuste') then raise exception 'Tipo de movimentação inválido'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Informe ao menos uma peça'; end if;
  if v_data > current_date then raise exception 'A data não pode ser futura'; end if;
  if p_tipo in ('baixa','ajuste') and v_obs is null then raise exception 'Informe o motivo'; end if;

  if p_tipo in ('saida','devolucao') then
    if p_colaborador is null then raise exception 'Informe o colaborador'; end if;
    perform privado.exigir('colaborador.ler', privado.loja_do_colaborador(p_colaborador));
    select v.id into v_vinc from public.vinculos v where v.colaborador_id = p_colaborador
     order by (v.status in ('desligado','arquivado')), v.criado_em desc limit 1;
  elsif p_colaborador is not null then
    raise exception 'Colaborador só é informado em entrega ou devolução';
  end if;

  select nome into v_nome_usuario from public.usuarios where id = auth.uid();

  for v_linha in select * from jsonb_array_elements(p_itens) loop
    v_qtd := (v_linha ->> 'quantidade')::integer;
    -- trava a linha da peça: duas pessoas não tiram a mesma última unidade
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
        if v_delta = 0 then continue; end if;   -- contagem bateu: nada a lançar
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

-- Estorna (desfaz) uma movimentação errada, deixando o registro
create or replace function public.uniforme_estornar(p_movimento uuid, p_motivo text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_mov public.uniforme_movimentos; v_item public.uniforme_itens; v_id uuid; v_vinc uuid;
begin
  perform privado.exigir('uniforme.movimentar', null);
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

revoke all on function public.uniforme_item_salvar(uuid, text, text, text, integer, boolean) from public, anon;
revoke all on function public.uniforme_movimentar(text, jsonb, uuid, date, text) from public, anon;
revoke all on function public.uniforme_estornar(uuid, text) from public, anon;
grant execute on function public.uniforme_item_salvar(uuid, text, text, text, integer, boolean) to authenticated;
grant execute on function public.uniforme_movimentar(text, jsonb, uuid, date, text) to authenticated;
grant execute on function public.uniforme_estornar(uuid, text) to authenticated;
revoke all on function privado.saldo_uniforme(uuid), privado.posse_uniforme(uuid, uuid) from public, anon;

-- ---------------------------------------------------------------------
-- Views para a interface (rodam com as permissões de quem consulta)
-- ---------------------------------------------------------------------
create view public.v_uniformes_estoque with (security_invoker = true) as
select i.id, i.grupo, i.peca, i.tamanho, i.estoque_minimo, i.ativo,
       coalesce(m.saldo, 0)::integer as saldo,
       coalesce(m.com_colaboradores, 0)::integer as com_colaboradores,
       case when i.ativo then greatest(i.estoque_minimo - coalesce(m.saldo, 0), 0) else 0 end::integer as a_pedir,
       m.ultima_movimentacao
  from public.uniforme_itens i
  left join (
    select item_id, sum(delta) as saldo, sum(posse_delta) as com_colaboradores, max(data_movimento) as ultima_movimentacao
      from public.uniforme_movimentos group by item_id
  ) m on m.item_id = i.id;

create view public.v_uniformes_movimentos with (security_invoker = true) as
select m.id, m.item_id, i.grupo, i.peca, i.tamanho, m.tipo, m.quantidade, m.delta, m.posse_delta,
       m.colaborador_id, c.nome_completo as colaborador_nome, l.nome as loja_nome,
       m.data_movimento, m.observacao, m.estorno_de,
       exists (select 1 from public.uniforme_movimentos e where e.estorno_de = m.id) as estornado,
       m.registrado_por_nome, m.registrado_em
  from public.uniforme_movimentos m
  join public.uniforme_itens i on i.id = m.item_id
  left join public.colaboradores c on c.id = m.colaborador_id
  left join public.lojas l on l.id = c.loja_atual_id;

create view public.v_uniformes_posse with (security_invoker = true) as
select m.colaborador_id, c.nome_completo as colaborador_nome, l.nome as loja_nome,
       m.item_id, i.grupo, i.peca, i.tamanho,
       sum(m.posse_delta)::integer as quantidade,
       max(m.data_movimento) filter (where m.tipo = 'saida') as ultima_entrega
  from public.uniforme_movimentos m
  join public.uniforme_itens i on i.id = m.item_id
  left join public.colaboradores c on c.id = m.colaborador_id
  left join public.lojas l on l.id = c.loja_atual_id
 where m.colaborador_id is not null
 group by m.colaborador_id, c.nome_completo, l.nome, m.item_id, i.grupo, i.peca, i.tamanho
having sum(m.posse_delta) > 0;

revoke all on public.v_uniformes_estoque, public.v_uniformes_movimentos, public.v_uniformes_posse from anon, public;
grant select on public.v_uniformes_estoque, public.v_uniformes_movimentos, public.v_uniformes_posse to authenticated;
