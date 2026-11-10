-- Aviso prévio no desligamento + categoria Declaração com horário e CID
-- 1) desligamentos: tipo de aviso, redução (2h/dia ou 7 dias), dias, fim do aviso e último dia de trabalho
-- 2) iniciar_desligamento aceita p_aviso jsonb (assinatura antiga continua funcionando)
-- 3) categoria declaracao_comparecimento (sigilo saúde, como atestados)
-- 4) documentos: horario_inicio, horario_fim, cid (cid só em categoria de saúde)

-- ---------------------------------------------------------------------
-- 1) Aviso prévio
-- ---------------------------------------------------------------------
alter table public.desligamentos
  add column aviso_tipo    text check (aviso_tipo in ('trabalhado','indenizado','dispensado','nao_cumpre')),
  add column aviso_reducao text check (aviso_reducao in ('2h_dia','7_dias')),
  add column aviso_dias    int  check (aviso_dias between 1 and 90),
  add column fim_aviso     date,
  add column ultimo_dia    date,
  add constraint desligamentos_reducao_so_trabalhado check (aviso_reducao is null or aviso_tipo = 'trabalhado'),
  add constraint desligamentos_ultimo_dia_valido check (ultimo_dia is null or ultimo_dia >= data_comunicacao),
  add constraint desligamentos_fim_aviso_valido check (fim_aviso is null or fim_aviso >= data_comunicacao);

drop function public.iniciar_desligamento(uuid, text, date, text);

create function public.iniciar_desligamento(
  p_vinculo uuid, p_modalidade text, p_data_comunicacao date, p_observacoes text default null,
  p_aviso jsonb default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_loja uuid := privado.loja_do_vinculo(p_vinculo); v_id uuid;
  v_tipo text := nullif(trim(p_aviso ->> 'tipo'), '');
  v_red  text := nullif(trim(p_aviso ->> 'reducao'), '');
  v_dias int  := nullif(p_aviso ->> 'dias', '')::int;
  v_fim  date := nullif(p_aviso ->> 'fim_aviso', '')::date;
  v_ult  date := nullif(p_aviso ->> 'ultimo_dia', '')::date;
begin
  if v_loja is null then raise exception 'Vínculo não encontrado'; end if;
  perform privado.exigir('desligamento.gerir', v_loja);
  if coalesce(trim(p_modalidade), '') = '' then raise exception 'Informe a modalidade de desligamento'; end if;
  if p_aviso is not null then
    if v_tipo is null then raise exception 'Informe como fica o aviso prévio'; end if;
    if p_modalidade = 'pedido_demissao' and v_tipo not in ('trabalhado','dispensado','nao_cumpre') then
      raise exception 'Opção de aviso inválida para pedido de demissão';
    end if;
    if p_modalidade <> 'pedido_demissao' and v_tipo not in ('trabalhado','indenizado') then
      raise exception 'Opção de aviso inválida para esta modalidade';
    end if;
    if v_tipo = 'trabalhado' and p_modalidade <> 'pedido_demissao' and v_red is null then
      raise exception 'Informe a redução durante o aviso (2 horas por dia ou 7 dias)';
    end if;
    if v_tipo <> 'trabalhado' or p_modalidade = 'pedido_demissao' then v_red := null; end if;
    if v_ult is null then raise exception 'Informe o último dia de trabalho'; end if;
  end if;

  insert into public.desligamentos (vinculo_id, modalidade, data_comunicacao, observacoes,
      aviso_tipo, aviso_reducao, aviso_dias, fim_aviso, ultimo_dia)
  values (p_vinculo, p_modalidade, p_data_comunicacao, p_observacoes,
      v_tipo, v_red, v_dias, v_fim, v_ult)
  returning id into v_id;
  perform public.alterar_status_vinculo(p_vinculo, 'em_desligamento', 'Processo de desligamento iniciado', p_data_comunicacao);
  return v_id;
end $$;

revoke all on function public.iniciar_desligamento(uuid, text, date, text, jsonb) from public, anon;
grant execute on function public.iniciar_desligamento(uuid, text, date, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Categoria Declaração
-- ---------------------------------------------------------------------
insert into public.doc_categorias (codigo, nome, nivel_sigilo, exige_vencimento, exige_competencia, retencao_observacao, dica_ia)
values ('declaracao_comparecimento', 'Declarações (comparecimento / horas)', 'saude', false, false,
        'Mesmo prazo de guarda dos atestados médicos',
        'Declaração de comparecimento ou de horas: consulta, exame, acompanhamento de familiar, órgão público ou escola, com horário de entrada e saída')
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------------
-- 4) Horário e CID nos documentos
-- ---------------------------------------------------------------------
alter table public.documentos
  add column horario_inicio time,
  add column horario_fim    time,
  add column cid            text check (cid is null or cid ~ '^[A-Z][0-9]{2}(\.?[0-9]{1,2})?$'),
  add constraint documentos_horario_valido check (horario_fim is null or horario_inicio is null or horario_fim > horario_inicio);

create or replace function privado.documento_validar_saude()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.cid := nullif(upper(replace(trim(new.cid), ' ', '')), '');
  if new.cid is not null and not exists (
       select 1 from public.doc_categorias c where c.id = new.categoria_id and c.nivel_sigilo = 'saude') then
    raise exception 'CID só pode ser informado em documento de saúde (atestado ou declaração)';
  end if;
  return new;
end $$;
revoke all on function privado.documento_validar_saude() from public, anon, authenticated;

create trigger b_validar_saude before insert or update of cid, categoria_id on public.documentos
  for each row execute function privado.documento_validar_saude();

-- o upload grava os campos novos vindos do meta
do $do$
declare d text;
begin
  d := pg_get_functiondef('public.documento_preparar_upload(uuid,jsonb,text,text,bigint,text,text)'::regprocedure);
  if position('horario_inicio' in d) > 0 then return; end if;
  d := replace(d, 'status_assinatura, observacoes, enviado_por, status)',
                  'status_assinatura, observacoes, enviado_por, status, horario_inicio, horario_fim, cid)');
  d := replace(d, $r$privado.texto(p_meta, 'observacoes'), auth.uid(), 'pendente')$r$,
                  $r$privado.texto(p_meta, 'observacoes'), auth.uid(), 'pendente',
        (privado.texto(p_meta, 'horario_inicio'))::time, (privado.texto(p_meta, 'horario_fim'))::time,
        privado.texto(p_meta, 'cid'))$r$);
  if position('horario_inicio' in d) = 0 or position($r$'cid')$r$ in d) = 0 then
    raise exception 'Não foi possível ajustar documento_preparar_upload';
  end if;
  execute d;
end $do$;

-- correção depois do envio (tela de conferência)
create function public.documento_ajustar_horario(p_documento uuid, p_inicio time, p_fim time, p_cid text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_doc public.documentos%rowtype;
begin
  select * into v_doc from public.documentos where id = p_documento for update;
  if v_doc.id is null then raise exception 'Documento não encontrado'; end if;
  if not privado.pode_documento('enviar', v_doc.categoria_id, v_doc.loja_id) then
    raise exception 'Sem permissão para alterar este documento' using errcode = '42501';
  end if;
  if v_doc.status = 'arquivado' then raise exception 'Documento arquivado não pode ser alterado'; end if;
  update public.documentos set horario_inicio = p_inicio, horario_fim = p_fim, cid = nullif(trim(p_cid), '')
   where id = p_documento;
end $$;
revoke all on function public.documento_ajustar_horario(uuid, time, time, text) from public, anon;
grant execute on function public.documento_ajustar_horario(uuid, time, time, text) to authenticated;

create or replace view public.v_documentos with (security_invoker = true) as
select d.id, d.nome, d.categoria_id, cat.nome as categoria_nome, cat.nivel_sigilo,
       d.colaborador_id, col.nome_completo as colaborador_nome,
       d.loja_id, l.nome as loja_nome,
       d.data_emissao, d.data_recebimento, d.competencia, d.vencimento,
       d.status, d.status_assinatura, d.versao_atual, d.observacoes,
       d.enviado_por, d.conferido_por, d.conferido_em, d.criado_em, d.atualizado_em,
       d.horario_inicio, d.horario_fim, d.cid, cat.codigo as categoria_codigo
  from public.documentos d
  join public.doc_categorias cat on cat.id = d.categoria_id
  join public.lojas l on l.id = d.loja_id
  left join public.colaboradores col on col.id = d.colaborador_id;
