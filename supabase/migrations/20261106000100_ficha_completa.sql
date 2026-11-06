-- =====================================================================
-- IDEALIZE RH 360º — Ficha completa (todos os campos do Registro de Empregado)
-- Campos novos em tabela própria, sem leitura direta: só pelas funções,
-- que checam permissão e registram auditoria.
--   * contrato (função, CBO, horários, FGTS, departamento): colaborador.ler / colaborador.editar
--   * pessoais, documentos, contato, banco e dependentes: colaborador.dados_pessoais.ler / .editar
-- =====================================================================
create table public.colaborador_ficha (
  colaborador_id       uuid primary key references public.colaboradores(id) on delete restrict,
  -- contrato
  funcao               text, cbo text, horario_intervalo text, fgts_opcao date,
  departamento_texto   text, centro_custo text,
  -- pessoais
  local_nascimento     text, nacionalidade text, estado_civil text, sexo text, cor_raca text,
  grau_instrucao       text, deficiencia text, nome_pai text, nome_mae text,
  -- documentos
  rg text, rg_emissao date, rg_orgao text,
  ctps text, ctps_serie text, ctps_emissao date, ctps_uf text,
  pis text, pis_cadastro date,
  titulo_eleitor text, titulo_zona text, titulo_secao text,
  cnh text, cnh_categoria text, doc_militar text, orgao_classe text,
  -- contato e banco
  telefone_residencial text, banco text, agencia text, conta text,
  atualizado_por       uuid references public.usuarios(id) default auth.uid(),
  atualizado_em        timestamptz not null default now()
);
create trigger a_maiusculas before insert or update on public.colaborador_ficha
  for each row execute function privado.maiusculas('funcao', 'cbo', 'horario_intervalo', 'departamento_texto', 'centro_custo',
    'local_nascimento', 'nacionalidade', 'estado_civil', 'sexo', 'cor_raca', 'grau_instrucao', 'deficiencia', 'nome_pai', 'nome_mae',
    'rg', 'rg_orgao', 'ctps', 'ctps_serie', 'ctps_uf', 'pis', 'titulo_eleitor', 'titulo_zona', 'titulo_secao', 'cnh', 'cnh_categoria',
    'doc_militar', 'orgao_classe', 'telefone_residencial', 'banco', 'agencia', 'conta');
create trigger auditar after insert or update or delete on public.colaborador_ficha
  for each row execute function privado.auditar();
alter table public.colaborador_ficha enable row level security;   -- sem política: leitura só pelas funções
revoke all on public.colaborador_ficha from anon, authenticated;

create table public.colaborador_dependentes (
  id               uuid primary key default gen_random_uuid(),
  colaborador_id   uuid not null references public.colaboradores(id) on delete restrict,
  nome             text not null check (length(trim(nome)) > 1),
  parentesco       text,
  data_nascimento  date,
  criado_em        timestamptz not null default now()
);
create index on public.colaborador_dependentes (colaborador_id);
create trigger a_maiusculas before insert or update on public.colaborador_dependentes
  for each row execute function privado.maiusculas('nome', 'parentesco');
create trigger auditar after insert or update or delete on public.colaborador_dependentes
  for each row execute function privado.auditar();
alter table public.colaborador_dependentes enable row level security;
revoke all on public.colaborador_dependentes from anon, authenticated;

-- ---------------------------------------------------------------------
-- Leitura: contrato sempre; o resto só com p_completo (auditado)
-- ---------------------------------------------------------------------
create or replace function public.colaborador_ficha(p_colaborador uuid, p_completo boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_loja uuid := privado.loja_do_colaborador(p_colaborador);
  r jsonb; f public.colaborador_ficha; c public.colaboradores; v record;
begin
  if v_loja is null then raise exception 'Colaborador não encontrado'; end if;
  if not privado.pode('colaborador.ler', v_loja) then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select * into f from public.colaborador_ficha where colaborador_id = p_colaborador;
  select vi.*, e.razao_social, e.cnpj, cg.experiencia_dias_1 as d1, cg.experiencia_dias_2 as d2
    into v
    from public.vinculos vi join public.empresas e on e.id = vi.empresa_id left join public.cargos cg on cg.id = vi.cargo_id
   where vi.colaborador_id = p_colaborador order by (vi.status in ('desligado', 'arquivado')), vi.data_admissao desc nulls first limit 1;

  r := jsonb_build_object(
    'empresa', v.razao_social, 'cnpj', v.cnpj,
    'funcao', f.funcao, 'cbo', f.cbo, 'horario_intervalo', f.horario_intervalo, 'fgts_opcao', f.fgts_opcao,
    'departamento', f.departamento_texto, 'centro_custo', f.centro_custo,
    'fim_experiencia_1', case when v.tipo = 'clt_experiencia' and v.data_admissao is not null then v.data_admissao + coalesce(v.d1, 15) - 1 end,
    'fim_experiencia_2', case when v.tipo = 'clt_experiencia' and v.data_admissao is not null then v.data_admissao + coalesce(v.d1, 15) + coalesce(v.d2, 15) - 1 end,
    'completo', false);

  if not p_completo then return r; end if;
  if not privado.pode('colaborador.dados_pessoais.ler', v_loja) then
    perform privado.registrar_evento('LER_FICHA_COMPLETA', 'colaboradores', p_colaborador::text, v_loja, null, 'negado');
    return r;
  end if;
  select * into c from public.colaboradores where id = p_colaborador;
  perform privado.registrar_evento('LER_FICHA_COMPLETA', 'colaboradores', p_colaborador::text, v_loja);
  return r || jsonb_build_object(
    'completo', true,
    'cpf', c.cpf, 'data_nascimento', c.data_nascimento, 'email', c.email, 'telefone', c.telefone,
    'cep', c.cep, 'logradouro', c.logradouro, 'numero', c.numero, 'complemento', c.complemento,
    'bairro', c.bairro, 'cidade', c.cidade, 'uf', c.uf,
    'local_nascimento', f.local_nascimento, 'nacionalidade', f.nacionalidade, 'estado_civil', f.estado_civil,
    'sexo', f.sexo, 'cor_raca', f.cor_raca, 'grau_instrucao', f.grau_instrucao, 'deficiencia', f.deficiencia,
    'nome_pai', f.nome_pai, 'nome_mae', f.nome_mae,
    'rg', f.rg, 'rg_emissao', f.rg_emissao, 'rg_orgao', f.rg_orgao,
    'ctps', f.ctps, 'ctps_serie', f.ctps_serie, 'ctps_emissao', f.ctps_emissao, 'ctps_uf', f.ctps_uf,
    'pis', f.pis, 'pis_cadastro', f.pis_cadastro,
    'titulo_eleitor', f.titulo_eleitor, 'titulo_zona', f.titulo_zona, 'titulo_secao', f.titulo_secao,
    'cnh', f.cnh, 'cnh_categoria', f.cnh_categoria, 'doc_militar', f.doc_militar, 'orgao_classe', f.orgao_classe,
    'telefone_residencial', f.telefone_residencial, 'banco', f.banco, 'agencia', f.agencia, 'conta', f.conta,
    'dependentes', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'nome', d.nome, 'parentesco', d.parentesco,
                               'data_nascimento', d.data_nascimento) order by d.data_nascimento nulls last, d.nome)
                               from public.colaborador_dependentes d where d.colaborador_id = p_colaborador), '[]'::jsonb));
end $$;
revoke all on function public.colaborador_ficha(uuid, boolean) from public, anon;
grant execute on function public.colaborador_ficha(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Edição por bloco. Só as chaves enviadas mudam; texto vazio limpa o campo.
-- ---------------------------------------------------------------------
create or replace function public.colaborador_ficha_salvar(p_colaborador uuid, p_bloco text, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_loja uuid := privado.loja_do_colaborador(p_colaborador);
  k text; tipo text; base jsonb := '{}'::jsonb; dep jsonb;
  cols_ficha jsonb := case p_bloco
    when 'contrato'   then '{"funcao":"text","cbo":"text","horario_intervalo":"text","fgts_opcao":"date","departamento_texto":"text","centro_custo":"text"}'
    when 'pessoais'   then '{"local_nascimento":"text","nacionalidade":"text","estado_civil":"text","sexo":"text","cor_raca":"text","grau_instrucao":"text","deficiencia":"text","nome_pai":"text","nome_mae":"text"}'
    when 'documentos' then '{"rg":"text","rg_emissao":"date","rg_orgao":"text","ctps":"text","ctps_serie":"text","ctps_emissao":"date","ctps_uf":"text","pis":"text","pis_cadastro":"date","titulo_eleitor":"text","titulo_zona":"text","titulo_secao":"text","cnh":"text","cnh_categoria":"text","doc_militar":"text","orgao_classe":"text"}'
    when 'contato'    then '{"telefone_residencial":"text"}'
    when 'banco'      then '{"banco":"text","agencia":"text","conta":"text"}'
    else '{}' end::jsonb;
  cols_base text[] := case p_bloco
    when 'pessoais'   then array['nome_completo', 'nome_social', 'data_nascimento']
    when 'documentos' then array['cpf']
    when 'contato'    then array['email', 'telefone', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf']
    else array[]::text[] end;
begin
  if v_loja is null then raise exception 'Colaborador não encontrado'; end if;
  if p_bloco not in ('contrato', 'pessoais', 'documentos', 'contato', 'banco', 'dependentes') then raise exception 'Bloco inválido'; end if;
  perform privado.exigir(case when p_bloco = 'contrato' then 'colaborador.editar' else 'colaborador.dados_pessoais.editar' end, v_loja);
  if jsonb_typeof(p) <> 'object' then raise exception 'Dados inválidos'; end if;

  if p_bloco = 'dependentes' then
    if jsonb_typeof(p -> 'dependentes') <> 'array' or jsonb_array_length(p -> 'dependentes') > 20 then raise exception 'Lista de dependentes inválida'; end if;
    delete from public.colaborador_dependentes where colaborador_id = p_colaborador;
    for dep in select * from jsonb_array_elements(p -> 'dependentes') loop
      if length(trim(coalesce(dep ->> 'nome', ''))) > 1 then
        insert into public.colaborador_dependentes (colaborador_id, nome, parentesco, data_nascimento)
        values (p_colaborador, trim(dep ->> 'nome'), nullif(trim(dep ->> 'parentesco'), ''), nullif(dep ->> 'data_nascimento', '')::date);
      end if;
    end loop;
    return;
  end if;

  -- campos que já existem no cadastro: passa pela função de sempre
  for k in select jsonb_object_keys(p) loop
    if k = any (cols_base) then base := base || jsonb_build_object(k, p -> k); end if;
  end loop;
  if base <> '{}'::jsonb then perform public.atualizar_dados_pessoais(p_colaborador, base); end if;
  -- jornada e horário de trabalho ficam no vínculo
  if p_bloco = 'contrato' and (p ? 'jornada_semanal_horas' or p ? 'escala') then
    perform public.atualizar_vinculo(
      (select vi.id from public.vinculos vi where vi.colaborador_id = p_colaborador
        order by (vi.status in ('desligado', 'arquivado')), vi.data_admissao desc nulls first limit 1),
      jsonb_strip_nulls(jsonb_build_object('jornada_semanal_horas', nullif(p ->> 'jornada_semanal_horas', ''),
                                           'escala', case when p ? 'escala' then coalesce(nullif(trim(p ->> 'escala'), ''), '') end)));
  end if;

  -- campos novos
  insert into public.colaborador_ficha (colaborador_id) values (p_colaborador) on conflict do nothing;
  for k in select jsonb_object_keys(p) loop
    tipo := cols_ficha ->> k;
    if tipo is null then continue; end if;
    if length(coalesce(p ->> k, '')) > 200 then raise exception 'Campo % muito longo', k; end if;
    execute format('update public.colaborador_ficha set %I = nullif(trim($1), '''')::%s, atualizado_por = auth.uid(), atualizado_em = now() where colaborador_id = $2',
                   k, case tipo when 'date' then 'date' else 'text' end)
      using p ->> k, p_colaborador;
  end loop;
end $$;
revoke all on function public.colaborador_ficha_salvar(uuid, text, jsonb) from public, anon;
grant execute on function public.colaborador_ficha_salvar(uuid, text, jsonb) to authenticated;
