-- =====================================================================
-- IDEALIZE RH 360º — Migração 005: regras de negócio e RLS de pessoas
-- =====================================================================
-- Escrita em colaboradores/vínculos/lotação/cargos/remuneração acontece
-- SOMENTE por funções (security definer) que validam permissão + regra.
-- A API REST só lê, e só o que a RLS permitir.
-- =====================================================================

-- CPF mascarado para quem não pode ver dados pessoais completos
alter table public.colaboradores
  add column cpf_mascarado text generated always as
    ('***.' || substr(cpf, 4, 3) || '.' || substr(cpf, 7, 3) || '-**') stored;

-- ---------------------------------------------------------------------
-- Privilégios de coluna/tabela: leitura básica liberada pela RLS,
-- dados pessoais completos só via função auditada.
-- ---------------------------------------------------------------------
revoke all on public.colaboradores from anon, authenticated;
grant select (id, nome_completo, nome_social, cpf_mascarado, loja_atual_id, usuario_id, criado_em, atualizado_em)
  on public.colaboradores to authenticated;

revoke insert, update, delete on public.vinculos, public.lotacoes, public.historico_cargos,
  public.remuneracoes, public.vinculo_status_historico, public.desligamentos,
  public.usuario_atribuicoes, public.usuarios, public.perfis, public.permissoes, public.perfil_permissoes
  from anon, authenticated;
revoke all on all tables in schema public from anon;

alter table public.colaboradores            enable row level security;
alter table public.contatos_emergencia      enable row level security;
alter table public.vinculos                 enable row level security;
alter table public.lotacoes                 enable row level security;
alter table public.historico_cargos         enable row level security;
alter table public.remuneracoes             enable row level security;
alter table public.status_transicoes        enable row level security;
alter table public.vinculo_status_historico enable row level security;
alter table public.desligamentos            enable row level security;

create policy colaboradores_ler on public.colaboradores for select to authenticated
  using (privado.pode('colaborador.ler', loja_atual_id) or usuario_id = auth.uid());

create policy contatos_ler on public.contatos_emergencia for select to authenticated
  using (privado.pode('colaborador.dados_pessoais.ler', privado.loja_do_colaborador(colaborador_id)));
create policy contatos_ins on public.contatos_emergencia for insert to authenticated
  with check (privado.pode('colaborador.dados_pessoais.editar', privado.loja_do_colaborador(colaborador_id)));
create policy contatos_upd on public.contatos_emergencia for update to authenticated
  using (privado.pode('colaborador.dados_pessoais.editar', privado.loja_do_colaborador(colaborador_id)))
  with check (privado.pode('colaborador.dados_pessoais.editar', privado.loja_do_colaborador(colaborador_id)));

create policy vinculos_ler on public.vinculos for select to authenticated
  using (privado.pode('colaborador.ler', privado.loja_do_colaborador(colaborador_id)));
create policy lotacoes_ler on public.lotacoes for select to authenticated
  using (privado.pode('colaborador.ler', privado.loja_do_vinculo(vinculo_id)));
create policy hcargos_ler on public.historico_cargos for select to authenticated
  using (privado.pode('colaborador.ler', privado.loja_do_vinculo(vinculo_id)));
create policy vsh_ler on public.vinculo_status_historico for select to authenticated
  using (privado.pode('colaborador.ler', privado.loja_do_vinculo(vinculo_id)));
create policy remuneracoes_ler on public.remuneracoes for select to authenticated
  using (privado.pode('remuneracao.ler', privado.loja_do_vinculo(vinculo_id)));
create policy desligamentos_ler on public.desligamentos for select to authenticated
  using (privado.pode('desligamento.gerir', privado.loja_do_vinculo(vinculo_id))
         or privado.pode('documento.contratual.ler', privado.loja_do_vinculo(vinculo_id)));
create policy transicoes_ler on public.status_transicoes for select to authenticated using (true);
create policy transicoes_gerir_ins on public.status_transicoes for insert to authenticated
  with check (privado.pode('config.estrutura.gerir'));
create policy transicoes_gerir_del on public.status_transicoes for delete to authenticated
  using (privado.pode('config.estrutura.gerir'));

-- ---------------------------------------------------------------------
-- Funções auxiliares internas
-- ---------------------------------------------------------------------
create or replace function privado.exigir(p_permissao text, p_loja uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not privado.pode(p_permissao, p_loja) then
    raise exception 'Acesso negado: permissão % necessária para esta loja', p_permissao
      using errcode = '42501';
  end if;
end $$;

create or replace function privado.texto(p jsonb, k text)
returns text language sql immutable set search_path = '' as $$
  select nullif(trim(p ->> k), '');
$$;

-- ---------------------------------------------------------------------
-- Cadastro de colaborador (colaborador + vínculo + lotação + cargo [+ salário])
-- ---------------------------------------------------------------------
create or replace function public.cadastrar_colaborador(p jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_loja       uuid := (p ->> 'loja_id')::uuid;
  v_empresa    uuid;
  v_status     public.vinculo_status := coalesce(privado.texto(p, 'status_inicial'), 'pre_admissao')::public.vinculo_status;
  v_admissao   date := (privado.texto(p, 'data_admissao'))::date;
  v_cargo      uuid := (privado.texto(p, 'cargo_id'))::uuid;
  v_salario    numeric := (privado.texto(p, 'salario_base'))::numeric;
  v_cpf        text := privado.so_digitos(p ->> 'cpf');
  v_col        uuid;
  v_vinc       uuid;
begin
  if v_loja is null then raise exception 'Informe a loja'; end if;
  perform privado.exigir('colaborador.criar', v_loja);

  select empresa_id into v_empresa from public.lojas where id = v_loja and ativa;
  if v_empresa is null then raise exception 'Loja inexistente ou inativa'; end if;

  if v_status not in ('pre_admissao', 'ativo') then
    raise exception 'Status inicial deve ser pre_admissao ou ativo (carga de colaboradores já contratados)';
  end if;
  if v_status = 'ativo' and v_admissao is null then
    raise exception 'Colaborador ativo precisa de data de admissão';
  end if;
  if privado.texto(p, 'matricula') is null then raise exception 'Informe a matrícula'; end if;
  if privado.texto(p, 'tipo') is null then raise exception 'Informe o tipo de vínculo'; end if;
  if v_salario is not null then perform privado.exigir('remuneracao.gerir', v_loja); end if;

  if exists (select 1 from public.colaboradores where cpf = v_cpf) then
    raise exception 'Já existe colaborador com este CPF. Para readmissão use o fluxo de admissão (Etapa 2).'
      using errcode = '23505';
  end if;

  insert into public.colaboradores (nome_completo, nome_social, cpf, data_nascimento, email, telefone,
      cep, logradouro, numero, complemento, bairro, cidade, uf, loja_atual_id)
  values (trim(p ->> 'nome_completo'), privado.texto(p, 'nome_social'), v_cpf,
      (privado.texto(p, 'data_nascimento'))::date, privado.texto(p, 'email'),
      nullif(privado.so_digitos(p ->> 'telefone'), ''),
      nullif(privado.so_digitos(p ->> 'cep'), ''), privado.texto(p, 'logradouro'), privado.texto(p, 'numero'),
      privado.texto(p, 'complemento'), privado.texto(p, 'bairro'), privado.texto(p, 'cidade'),
      upper(privado.texto(p, 'uf')), v_loja)
  returning id into v_col;

  perform set_config('idealize.via_funcao', 'status', true);
  insert into public.vinculos (colaborador_id, empresa_id, matricula, tipo, status, data_admissao, cargo_id,
      departamento_id, gestor_colaborador_id, jornada_semanal_horas, escala)
  values (v_col, v_empresa, trim(p ->> 'matricula'), (p ->> 'tipo')::public.vinculo_tipo, v_status, v_admissao,
      v_cargo, (privado.texto(p, 'departamento_id'))::uuid, (privado.texto(p, 'gestor_colaborador_id'))::uuid,
      (privado.texto(p, 'jornada_semanal_horas'))::numeric, privado.texto(p, 'escala'))
  returning id into v_vinc;
  perform set_config('idealize.via_funcao', '', true);

  insert into public.vinculo_status_historico (vinculo_id, de, para, motivo, data_efeito)
  values (v_vinc, null, v_status,
          case when v_status = 'ativo' then 'Carga inicial de colaborador já contratado' else 'Cadastro inicial' end,
          coalesce(v_admissao, current_date));

  insert into public.lotacoes (vinculo_id, loja_id, inicio, motivo)
  values (v_vinc, v_loja, coalesce(v_admissao, current_date), 'Lotação inicial');

  if v_cargo is not null then
    insert into public.historico_cargos (vinculo_id, cargo_id, inicio, tipo, motivo)
    values (v_vinc, v_cargo, coalesce(v_admissao, current_date), 'admissao', 'Cargo inicial');
  end if;

  if v_salario is not null then
    insert into public.remuneracoes (vinculo_id, salario_base, vigencia_inicio, motivo)
    values (v_vinc, v_salario, coalesce(v_admissao, current_date), 'Salário inicial');
  end if;

  perform privado.timeline(v_col, v_vinc, 'cadastro', coalesce(v_admissao, current_date),
    case when v_status = 'ativo' then 'Cadastro de colaborador já contratado' else 'Pré-admissão registrada' end);

  return v_col;
end $$;

-- ---------------------------------------------------------------------
-- Dados pessoais completos (leitura auditada) e edição
-- ---------------------------------------------------------------------
-- Retorna NULL quando o acesso é negado (tentativa fica auditada).
create or replace function public.colaborador_dados_pessoais(p_colaborador uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_loja uuid := privado.loja_do_colaborador(p_colaborador); v jsonb;
begin
  if v_loja is null then raise exception 'Colaborador não encontrado'; end if;
  if not privado.pode('colaborador.dados_pessoais.ler', v_loja) then
    -- não lança erro: um erro desfaria o registro da tentativa negada na auditoria
    perform privado.registrar_evento('LER_DADOS_PESSOAIS', 'colaboradores', p_colaborador::text, v_loja, null, 'negado');
    return null;
  end if;
  select jsonb_build_object(
      'cpf', cpf, 'data_nascimento', data_nascimento, 'email', email, 'telefone', telefone,
      'cep', cep, 'logradouro', logradouro, 'numero', numero, 'complemento', complemento,
      'bairro', bairro, 'cidade', cidade, 'uf', uf)
    into v from public.colaboradores where id = p_colaborador;
  perform privado.registrar_evento('LER_DADOS_PESSOAIS', 'colaboradores', p_colaborador::text, v_loja);
  return v;
end $$;

create or replace function public.atualizar_dados_pessoais(p_colaborador uuid, p jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_loja uuid := privado.loja_do_colaborador(p_colaborador);
begin
  if v_loja is null then raise exception 'Colaborador não encontrado'; end if;
  perform privado.exigir('colaborador.dados_pessoais.editar', v_loja);
  update public.colaboradores set
    nome_completo   = coalesce(privado.texto(p, 'nome_completo'), nome_completo),
    nome_social     = case when p ? 'nome_social' then privado.texto(p, 'nome_social') else nome_social end,
    cpf             = coalesce(nullif(privado.so_digitos(p ->> 'cpf'), ''), cpf),
    data_nascimento = case when p ? 'data_nascimento' then (privado.texto(p, 'data_nascimento'))::date else data_nascimento end,
    email           = case when p ? 'email' then privado.texto(p, 'email') else email end,
    telefone        = case when p ? 'telefone' then nullif(privado.so_digitos(p ->> 'telefone'), '') else telefone end,
    cep             = case when p ? 'cep' then nullif(privado.so_digitos(p ->> 'cep'), '') else cep end,
    logradouro      = case when p ? 'logradouro' then privado.texto(p, 'logradouro') else logradouro end,
    numero          = case when p ? 'numero' then privado.texto(p, 'numero') else numero end,
    complemento     = case when p ? 'complemento' then privado.texto(p, 'complemento') else complemento end,
    bairro          = case when p ? 'bairro' then privado.texto(p, 'bairro') else bairro end,
    cidade          = case when p ? 'cidade' then privado.texto(p, 'cidade') else cidade end,
    uf              = case when p ? 'uf' then upper(privado.texto(p, 'uf')) else uf end
  where id = p_colaborador;
end $$;

-- ---------------------------------------------------------------------
-- Dados profissionais do vínculo (não altera status, cargo, salário ou loja)
-- ---------------------------------------------------------------------
create or replace function public.atualizar_vinculo(p_vinculo uuid, p jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_loja uuid := privado.loja_do_vinculo(p_vinculo); v_status public.vinculo_status;
begin
  if v_loja is null then raise exception 'Vínculo não encontrado'; end if;
  perform privado.exigir('colaborador.editar', v_loja);
  select status into v_status from public.vinculos where id = p_vinculo;
  if p ? 'data_admissao' and v_status not in ('pre_admissao', 'em_admissao') then
    raise exception 'Data de admissão só pode ser alterada antes da admissão ser concluída';
  end if;
  update public.vinculos set
    departamento_id       = case when p ? 'departamento_id' then (privado.texto(p, 'departamento_id'))::uuid else departamento_id end,
    gestor_colaborador_id = case when p ? 'gestor_colaborador_id' then (privado.texto(p, 'gestor_colaborador_id'))::uuid else gestor_colaborador_id end,
    jornada_semanal_horas = case when p ? 'jornada_semanal_horas' then (privado.texto(p, 'jornada_semanal_horas'))::numeric else jornada_semanal_horas end,
    escala                = case when p ? 'escala' then privado.texto(p, 'escala') else escala end,
    data_admissao         = case when p ? 'data_admissao' then (privado.texto(p, 'data_admissao'))::date else data_admissao end
  where id = p_vinculo;
end $$;

-- ---------------------------------------------------------------------
-- Transferência entre lojas
-- ---------------------------------------------------------------------
create or replace function public.transferir_colaborador(
  p_colaborador uuid, p_loja_destino uuid, p_data date, p_motivo text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_origem uuid := privado.loja_do_colaborador(p_colaborador);
  v_emp_origem uuid; v_emp_destino uuid; v_vinc uuid; v_lot record;
begin
  if v_origem is null then raise exception 'Colaborador não encontrado'; end if;
  if v_origem = p_loja_destino then raise exception 'O colaborador já está nesta loja'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da transferência'; end if;
  perform privado.exigir('colaborador.transferir', v_origem);
  perform privado.exigir('colaborador.transferir', p_loja_destino);

  select empresa_id into v_emp_origem from public.lojas where id = v_origem;
  select empresa_id into v_emp_destino from public.lojas where id = p_loja_destino and ativa;
  if v_emp_destino is null then raise exception 'Loja de destino inexistente ou inativa'; end if;
  if v_emp_origem <> v_emp_destino then
    raise exception 'Transferência entre empresas (CNPJs) diferentes exige processo específico — pendente de validação com a contabilidade'
      using errcode = 'P0001';
  end if;

  select id into v_vinc from public.vinculos
   where colaborador_id = p_colaborador and empresa_id = v_emp_origem
     and status not in ('desligado', 'arquivado');
  if v_vinc is null then raise exception 'Colaborador sem vínculo em aberto'; end if;

  select * into v_lot from public.lotacoes where vinculo_id = v_vinc and fim is null;
  if v_lot.id is not null then
    if p_data < v_lot.inicio then raise exception 'Data da transferência anterior ao início da lotação atual'; end if;
    update public.lotacoes set fim = greatest(v_lot.inicio, p_data - 1) where id = v_lot.id;
  end if;
  insert into public.lotacoes (vinculo_id, loja_id, inicio, motivo) values (v_vinc, p_loja_destino, p_data, p_motivo);

  perform set_config('idealize.via_funcao', 'transferencia', true);
  update public.colaboradores set loja_atual_id = p_loja_destino where id = p_colaborador;
  perform set_config('idealize.via_funcao', '', true);

  perform privado.timeline(p_colaborador, v_vinc, 'transferencia', p_data,
    'Transferência de loja',
    (select o.nome from public.lojas o where o.id = v_origem) || ' → ' ||
    (select d.nome from public.lojas d where d.id = p_loja_destino) || '. Motivo: ' || p_motivo);
end $$;

-- ---------------------------------------------------------------------
-- Mudança de status (máquina de estados)
-- ---------------------------------------------------------------------
create or replace function public.alterar_status_vinculo(
  p_vinculo uuid, p_novo public.vinculo_status, p_motivo text, p_data_efeito date default current_date)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_loja uuid := privado.loja_do_vinculo(p_vinculo);
  v_atual public.vinculo_status; v_col uuid; v_req text; v_desl record;
begin
  if v_loja is null then raise exception 'Vínculo não encontrado'; end if;
  perform privado.exigir('vinculo.status.alterar', v_loja);
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da mudança de status'; end if;

  select status, colaborador_id into v_atual, v_col from public.vinculos where id = p_vinculo for update;
  select requisito into v_req from public.status_transicoes where de = v_atual and para = p_novo;
  if not found then
    raise exception 'Transição de status não permitida: % → %', v_atual, p_novo;
  end if;

  perform set_config('idealize.via_funcao', 'status', true);
  if v_req = 'desligamento_concluido' then
    select * into v_desl from public.desligamentos where vinculo_id = p_vinculo and status = 'concluido';
    if v_desl.id is null then
      raise exception 'Não é possível marcar como desligado sem processo de desligamento concluído';
    end if;
    update public.vinculos set status = p_novo, data_desligamento = v_desl.data_desligamento where id = p_vinculo;
    update public.lotacoes set fim = greatest(inicio, v_desl.data_desligamento) where vinculo_id = p_vinculo and fim is null;
    update public.historico_cargos set fim = greatest(inicio, v_desl.data_desligamento) where vinculo_id = p_vinculo and fim is null;
  else
    update public.vinculos set status = p_novo where id = p_vinculo;
  end if;
  perform set_config('idealize.via_funcao', '', true);

  insert into public.vinculo_status_historico (vinculo_id, de, para, motivo, data_efeito)
  values (p_vinculo, v_atual, p_novo, p_motivo, p_data_efeito);
  perform privado.timeline(v_col, p_vinculo, 'status', p_data_efeito,
    'Status: ' || replace(v_atual::text, '_', ' ') || ' → ' || replace(p_novo::text, '_', ' '),
    null, 'contratual');
end $$;

-- ---------------------------------------------------------------------
-- Desligamento (mínimo para a regra "desligado exige processo")
-- Fluxo completo com checklist, documentos e revogação de acessos: Etapa 2.
-- ---------------------------------------------------------------------
create or replace function public.iniciar_desligamento(
  p_vinculo uuid, p_modalidade text, p_data_comunicacao date, p_observacoes text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_loja uuid := privado.loja_do_vinculo(p_vinculo); v_id uuid;
begin
  if v_loja is null then raise exception 'Vínculo não encontrado'; end if;
  perform privado.exigir('desligamento.gerir', v_loja);
  if coalesce(trim(p_modalidade), '') = '' then raise exception 'Informe a modalidade de desligamento'; end if;
  insert into public.desligamentos (vinculo_id, modalidade, data_comunicacao, observacoes)
  values (p_vinculo, p_modalidade, p_data_comunicacao, p_observacoes) returning id into v_id;
  perform public.alterar_status_vinculo(p_vinculo, 'em_desligamento', 'Processo de desligamento iniciado', p_data_comunicacao);
  return v_id;
end $$;

create or replace function public.concluir_desligamento(p_desligamento uuid, p_data_desligamento date)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_vinc uuid; v_loja uuid; v_status text; v_adm date;
begin
  select d.vinculo_id, d.status, v.data_admissao into v_vinc, v_status, v_adm
    from public.desligamentos d join public.vinculos v on v.id = d.vinculo_id where d.id = p_desligamento;
  if v_vinc is null then raise exception 'Processo de desligamento não encontrado'; end if;
  v_loja := privado.loja_do_vinculo(v_vinc);
  perform privado.exigir('desligamento.gerir', v_loja);
  if v_status <> 'em_andamento' then raise exception 'Processo não está em andamento'; end if;
  if p_data_desligamento is null or (v_adm is not null and p_data_desligamento < v_adm) then
    raise exception 'Data de desligamento inválida';
  end if;
  update public.desligamentos
     set status = 'concluido', data_desligamento = p_data_desligamento,
         concluido_por = auth.uid(), concluido_em = now()
   where id = p_desligamento;
  perform public.alterar_status_vinculo(v_vinc, 'desligado', 'Desligamento concluído', p_data_desligamento);
end $$;

-- ---------------------------------------------------------------------
-- Cargo e remuneração
-- ---------------------------------------------------------------------
create or replace function public.alterar_cargo(
  p_vinculo uuid, p_cargo uuid, p_data date, p_tipo text, p_motivo text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_loja uuid := privado.loja_do_vinculo(p_vinculo); v_col uuid; v_nome text; v_aberto record;
begin
  if v_loja is null then raise exception 'Vínculo não encontrado'; end if;
  perform privado.exigir('cargo.alterar', v_loja);
  if p_tipo not in ('promocao', 'mudanca_funcao', 'correcao') then raise exception 'Tipo inválido'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo'; end if;
  select nome into v_nome from public.cargos where id = p_cargo and ativo;
  if v_nome is null then raise exception 'Cargo inexistente ou inativo'; end if;

  select * into v_aberto from public.historico_cargos where vinculo_id = p_vinculo and fim is null;
  if v_aberto.id is not null then
    if p_data < v_aberto.inicio then raise exception 'Data anterior ao cargo atual'; end if;
    update public.historico_cargos set fim = greatest(v_aberto.inicio, p_data - 1) where id = v_aberto.id;
  end if;
  insert into public.historico_cargos (vinculo_id, cargo_id, inicio, tipo, motivo)
  values (p_vinculo, p_cargo, p_data, p_tipo, p_motivo);
  update public.vinculos set cargo_id = p_cargo where id = p_vinculo returning colaborador_id into v_col;
  perform privado.timeline(v_col, p_vinculo, p_tipo, p_data,
    case p_tipo when 'promocao' then 'Promoção' when 'correcao' then 'Correção de cargo' else 'Mudança de função' end
    || ': ' || v_nome);
end $$;

create or replace function public.registrar_remuneracao(
  p_vinculo uuid, p_valor numeric, p_vigencia date, p_motivo text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_loja uuid := privado.loja_do_vinculo(p_vinculo); v_col uuid;
begin
  if v_loja is null then raise exception 'Vínculo não encontrado'; end if;
  perform privado.exigir('remuneracao.gerir', v_loja);
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da alteração salarial'; end if;
  insert into public.remuneracoes (vinculo_id, salario_base, vigencia_inicio, motivo)
  values (p_vinculo, p_valor, p_vigencia, p_motivo);
  select colaborador_id into v_col from public.vinculos where id = p_vinculo;
  perform privado.timeline(v_col, p_vinculo, 'remuneracao', p_vigencia, 'Alteração salarial registrada', p_motivo, 'financeiro');
end $$;

-- ---------------------------------------------------------------------
-- Permissões de execução
-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.cadastrar_colaborador(jsonb)',
    'public.colaborador_dados_pessoais(uuid)',
    'public.atualizar_dados_pessoais(uuid, jsonb)',
    'public.atualizar_vinculo(uuid, jsonb)',
    'public.transferir_colaborador(uuid, uuid, date, text)',
    'public.alterar_status_vinculo(uuid, public.vinculo_status, text, date)',
    'public.iniciar_desligamento(uuid, text, date, text)',
    'public.concluir_desligamento(uuid, date)',
    'public.alterar_cargo(uuid, uuid, date, text, text)',
    'public.registrar_remuneracao(uuid, numeric, date, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

revoke all on function privado.registrar_evento(text, text, text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function privado.timeline(uuid, uuid, text, date, text, text, text, uuid) from public, anon, authenticated;
revoke all on function privado.auditar() from public, anon, authenticated;
