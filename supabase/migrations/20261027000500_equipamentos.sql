-- =====================================================================
-- IDEALIZE RH 360º — Equipamentos sob responsabilidade do colaborador
-- Registro de entrega (data, quais equipamentos, identificação) com o
-- TERMO DE RESPONSABILIDADE assinado anexado; devolução com data e estado.
-- Nada é apagado: lançamento errado é cancelado com motivo.
-- =====================================================================

insert into public.permissoes (codigo, modulo, descricao, exige_mfa, sensivel) values
  ('equipamento.ler',   'equipamentos', 'Ver equipamentos sob responsabilidade dos colaboradores', false, false),
  ('equipamento.gerir', 'equipamentos', 'Registrar entrega e devolução de equipamentos',            false, false)
on conflict (codigo) do nothing;
insert into public.perfil_permissoes (perfil_id, permissao)
select p.id, x from public.perfis p, unnest(array['equipamento.ler', 'equipamento.gerir']) x
 where p.codigo in ('diretoria', 'rh_central', 'departamento_pessoal', 'gerente_loja', 'supervisor')
on conflict do nothing;

-- categoria do termo (sigilo geral: quem entrega na loja também anexa e consulta)
insert into public.doc_categorias (codigo, nome, nivel_sigilo, exige_vencimento, exige_competencia, retencao_observacao, dica_ia)
values ('termo_equipamento', 'Termos de responsabilidade de equipamentos', 'geral', false, false,
        'Guardar enquanto o equipamento estiver com o colaborador e após a devolução, conforme orientação jurídica',
        'Termo de responsabilidade, recibo ou comodato de equipamento entregue ao colaborador: celular, notebook, chip, tablet, crachá, chaves, máquina de cartão, ferramentas')
on conflict (codigo) do nothing;

create table public.equipamentos (
  id                     uuid primary key default gen_random_uuid(),
  colaborador_id         uuid not null references public.colaboradores(id) on delete restrict,
  tipo                   text not null check (length(trim(tipo)) between 2 and 60),
  descricao              text check (descricao is null or length(descricao) <= 200),   -- marca/modelo
  identificacao          text check (identificacao is null or length(identificacao) <= 120), -- patrimônio, série, IMEI, linha
  quantidade             int not null default 1 check (quantidade between 1 and 999),
  data_entrega           date not null,
  observacao             text check (observacao is null or length(observacao) <= 500),
  documento_id           uuid references public.documentos(id) on delete set null,     -- termo assinado
  devolvido_em           date,
  devolucao_estado       text check (devolucao_estado is null or devolucao_estado in ('bom', 'danificado', 'extraviado')),
  devolucao_observacao   text,
  devolucao_registrada_por uuid references public.usuarios(id),
  cancelado              boolean not null default false,
  cancelado_motivo       text,
  registrado_por         uuid references public.usuarios(id) default auth.uid(),
  registrado_em          timestamptz not null default now(),
  check (devolvido_em is null or devolvido_em >= data_entrega)
);
create index on public.equipamentos (colaborador_id, data_entrega desc);

create trigger a_maiusculas before insert or update on public.equipamentos
  for each row execute function privado.maiusculas('tipo', 'descricao', 'identificacao', 'observacao', 'devolucao_observacao', 'cancelado_motivo');
create trigger auditar after insert or update or delete on public.equipamentos
  for each row execute function privado.auditar();

create or replace function privado.travar_equipamento()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Equipamentos não são apagados; cancele com motivo'; end if;
  if coalesce(current_setting('idealize.via_funcao', true), '') <> 'equipamento' then
    raise exception 'Equipamentos só mudam pelas funções próprias' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger travar before update or delete on public.equipamentos
  for each row execute function privado.travar_equipamento();

alter table public.equipamentos enable row level security;
create policy equipamentos_ler on public.equipamentos for select to authenticated
  using (privado.pode('equipamento.ler', privado.loja_do_colaborador(colaborador_id)));
revoke insert, update, delete, truncate on public.equipamentos from anon, authenticated;
revoke all on public.equipamentos from anon;

-- o termo precisa ser um documento DESTE colaborador
create or replace function privado.validar_termo(p_documento uuid, p_colaborador uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_documento is null then return; end if;
  if not exists (select 1 from public.documentos d where d.id = p_documento and d.colaborador_id = p_colaborador) then
    raise exception 'O termo anexado não é deste colaborador';
  end if;
end $$;
revoke all on function privado.validar_termo(uuid, uuid) from public, anon, authenticated;

-- Entrega de um ou mais equipamentos (um termo pode cobrir todos)
create or replace function public.equipamento_entregar(p_colaborador uuid, p_data date, p_itens jsonb,
                                                       p_documento uuid default null, p_observacao text default null)
returns int language plpgsql security definer set search_path = '' as $$
declare v_loja uuid := privado.loja_do_colaborador(p_colaborador); i jsonb; n int := 0; v_lista text := '';
begin
  if v_loja is null then raise exception 'Colaborador não encontrado'; end if;
  perform privado.exigir('equipamento.gerir', v_loja);
  if p_data is null or p_data > current_date + 30 then raise exception 'Informe a data de entrega'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Informe ao menos um equipamento'; end if;
  if jsonb_array_length(p_itens) > 30 then raise exception 'Máximo de 30 equipamentos por entrega'; end if;
  perform privado.validar_termo(p_documento, p_colaborador);
  for i in select * from jsonb_array_elements(p_itens) loop
    if length(trim(coalesce(i ->> 'tipo', ''))) < 2 then raise exception 'Informe o equipamento'; end if;
    insert into public.equipamentos (colaborador_id, tipo, descricao, identificacao, quantidade, data_entrega, observacao, documento_id)
    values (p_colaborador, trim(i ->> 'tipo'), nullif(trim(i ->> 'descricao'), ''), nullif(trim(i ->> 'identificacao'), ''),
            coalesce(nullif(i ->> 'quantidade', '')::int, 1), p_data, nullif(trim(p_observacao), ''), p_documento);
    n := n + 1;
    v_lista := v_lista || case when n > 1 then ', ' else '' end || upper(trim(i ->> 'tipo'))
               || coalesce(' ' || upper(nullif(trim(i ->> 'descricao'), '')), '');
  end loop;
  perform privado.timeline(p_colaborador, null, 'equipamento', p_data,
    'ENTREGA DE EQUIPAMENTO' || case when n > 1 then 'S' else '' end, left(v_lista, 400), 'geral', p_documento);
  return n;
end $$;
revoke all on function public.equipamento_entregar(uuid, date, jsonb, uuid, text) from public, anon;
grant execute on function public.equipamento_entregar(uuid, date, jsonb, uuid, text) to authenticated;

-- Anexa o termo depois (para entregas já registradas sem o termo)
create or replace function public.equipamento_anexar_termo(p_ids uuid[], p_documento uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_colab uuid; n int;
begin
  select distinct e.colaborador_id into v_colab from public.equipamentos e where e.id = any (p_ids);
  if v_colab is null then raise exception 'Equipamento não encontrado'; end if;
  if (select count(distinct e.colaborador_id) from public.equipamentos e where e.id = any (p_ids)) > 1 then
    raise exception 'Os equipamentos são de colaboradores diferentes';
  end if;
  perform privado.exigir('equipamento.gerir', privado.loja_do_colaborador(v_colab));
  perform privado.validar_termo(p_documento, v_colab);
  perform set_config('idealize.via_funcao', 'equipamento', true);
  update public.equipamentos set documento_id = p_documento where id = any (p_ids) and not cancelado;
  get diagnostics n = row_count;
  perform set_config('idealize.via_funcao', '', true);
  return n;
end $$;
revoke all on function public.equipamento_anexar_termo(uuid[], uuid) from public, anon;
grant execute on function public.equipamento_anexar_termo(uuid[], uuid) to authenticated;

create or replace function public.equipamento_devolver(p_id uuid, p_data date, p_estado text, p_observacao text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  select e.*, privado.loja_do_colaborador(e.colaborador_id) as loja into v from public.equipamentos e where e.id = p_id for update;
  if v.id is null then raise exception 'Equipamento não encontrado'; end if;
  perform privado.exigir('equipamento.gerir', v.loja);
  if v.cancelado then raise exception 'Lançamento cancelado'; end if;
  if v.devolvido_em is not null then raise exception 'Equipamento já devolvido'; end if;
  if p_data is null or p_data < v.data_entrega then raise exception 'Data de devolução inválida'; end if;
  if p_estado not in ('bom', 'danificado', 'extraviado') then raise exception 'Informe o estado do equipamento'; end if;
  if p_estado <> 'bom' and length(trim(coalesce(p_observacao, ''))) < 3 then raise exception 'Descreva o dano ou a perda'; end if;
  perform set_config('idealize.via_funcao', 'equipamento', true);
  update public.equipamentos set devolvido_em = p_data, devolucao_estado = p_estado,
         devolucao_observacao = nullif(trim(p_observacao), ''), devolucao_registrada_por = auth.uid()
   where id = p_id;
  perform set_config('idealize.via_funcao', '', true);
  perform privado.timeline(v.colaborador_id, null, 'equipamento', p_data,
    case p_estado when 'extraviado' then 'EQUIPAMENTO EXTRAVIADO: ' else 'DEVOLUÇÃO DE EQUIPAMENTO: ' end
      || v.tipo || coalesce(' ' || v.descricao, ''),
    upper(nullif(trim(p_observacao), '')), 'geral');
end $$;
revoke all on function public.equipamento_devolver(uuid, date, text, text) from public, anon;
grant execute on function public.equipamento_devolver(uuid, date, text, text) to authenticated;

create or replace function public.equipamento_cancelar(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = '' as $$
declare v record;
begin
  select e.*, privado.loja_do_colaborador(e.colaborador_id) as loja into v from public.equipamentos e where e.id = p_id for update;
  if v.id is null then raise exception 'Equipamento não encontrado'; end if;
  perform privado.exigir('equipamento.gerir', v.loja);
  if v.cancelado then raise exception 'Já cancelado'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo do cancelamento'; end if;
  perform set_config('idealize.via_funcao', 'equipamento', true);
  update public.equipamentos set cancelado = true, cancelado_motivo = trim(p_motivo) where id = p_id;
  perform set_config('idealize.via_funcao', '', true);
  perform privado.timeline(v.colaborador_id, null, 'equipamento', current_date,
    'LANÇAMENTO DE EQUIPAMENTO CANCELADO: ' || v.tipo, upper(trim(p_motivo)), 'geral');
end $$;
revoke all on function public.equipamento_cancelar(uuid, text) from public, anon;
grant execute on function public.equipamento_cancelar(uuid, text) to authenticated;
