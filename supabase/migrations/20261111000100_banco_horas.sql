-- IDEALIZE RH 360º — Banco de horas (VR Ponto / Pontomais)
-- Um robô (GitHub Actions, todo dia às 9h) entra no SuperPortal da VR, gera o relatório
-- "Banco de horas" e envia as linhas para cá por public.banco_horas_receber (chave própria do robô).
-- O sistema casa cada nome do VR com o colaborador (pelo nome; se não casar, alguém vincula na tela).

create table privado.robo_chaves (
  nome  text primary key,
  hash  text not null check (hash ~ '^[0-9a-f]{64}$'),
  criado_em timestamptz not null default now()
);
revoke all on privado.robo_chaves from public, anon, authenticated;

create or replace function privado.bh_normal(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(upper(translate(regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g'),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
    'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')), '')
$$;

create table public.banco_horas_execucoes (
  id              uuid primary key default gen_random_uuid(),
  executado_em    timestamptz not null default now(),
  status          text not null check (status in ('ok', 'erro')),
  mensagem        text check (mensagem is null or length(mensagem) <= 1000),
  periodo_inicio  date,
  periodo_fim     date,
  linhas          int not null default 0,
  pessoas         int not null default 0
);
create index on public.banco_horas_execucoes (executado_em desc);

create table public.banco_horas_saldos (
  nome_norm       text not null,
  data            date not null,
  nome_vr         text not null,
  departamento    text,
  matricula       text,
  saldo_min       int not null,
  positivas_min   int not null default 0,
  negativas_min   int not null default 0,
  he50_min        int not null default 0,
  he100_min       int not null default 0,
  execucao_id     uuid not null references public.banco_horas_execucoes(id),
  atualizado_em   timestamptz not null default now(),
  primary key (nome_norm, data)
);
create index on public.banco_horas_saldos (data);

-- pendências de ponto do VR (relatório "Pendências"): registro faltando, falta não justificada, ajuste, abono
create table public.banco_horas_pendencias (
  id            bigint generated always as identity primary key,
  nome_norm     text not null,
  nome_vr       text not null,
  data          date not null,
  tipo          text not null check (tipo in ('registro_faltando', 'falta', 'ajuste', 'abono', 'outro')),
  descricao     text not null,
  status        text,
  execucao_id   uuid not null references public.banco_horas_execucoes(id)
);
create index on public.banco_horas_pendencias (nome_norm, data);
create index on public.banco_horas_pendencias (data);

-- vínculo manual nome do VR -> colaborador (quando o nome não bate)
create table public.banco_horas_vinculos (
  nome_norm       text primary key,
  colaborador_id  uuid not null references public.colaboradores(id),
  vinculado_por   uuid references public.usuarios(id) default auth.uid(),
  vinculado_em    timestamptz not null default now()
);
create trigger auditar after insert or update or delete on public.banco_horas_vinculos
  for each row execute function privado.auditar();

alter table public.banco_horas_execucoes enable row level security;
alter table public.banco_horas_saldos enable row level security;
alter table public.banco_horas_vinculos enable row level security;
alter table public.banco_horas_pendencias enable row level security;
revoke all on public.banco_horas_execucoes, public.banco_horas_saldos, public.banco_horas_vinculos, public.banco_horas_pendencias from anon, authenticated;

-- nome do VR -> colaborador (vínculo manual tem prioridade; senão, nome igual e único)
create or replace function privado.bh_colaborador(p_nome_norm text) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select v.colaborador_id from public.banco_horas_vinculos v where v.nome_norm = p_nome_norm),
    (select min(c.id::text)::uuid from public.colaboradores c
      where privado.bh_normal(c.nome_completo) = p_nome_norm
     having count(*) = 1))
$$;
revoke all on function privado.bh_colaborador(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Entrada do robô (anon + chave própria)
-- p_execucao: {status:'ok'|'erro', mensagem, periodo_inicio, periodo_fim}
-- p_linhas:   [{nome, departamento, matricula, data, saldo_min, positivas_min, negativas_min, he50_min, he100_min}]
-- p_pendencias: [{nome, data, pendencia, status}]  (substitui as pendências do período lido)
-- ---------------------------------------------------------------------
create or replace function public.banco_horas_receber(p_chave text, p_execucao jsonb, p_linhas jsonb default '[]', p_pendencias jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_n int := 0; v_p int := 0; l jsonb;
begin
  if p_chave is null or not exists (select 1 from privado.robo_chaves k
       where k.nome = 'banco_horas' and k.hash = encode(extensions.digest(p_chave, 'sha256'), 'hex')) then
    raise exception 'Chave inválida' using errcode = '42501';
  end if;
  if coalesce(p_execucao->>'status', '') not in ('ok', 'erro') then raise exception 'Status inválido'; end if;
  if jsonb_typeof(coalesce(p_linhas, '[]')) <> 'array' or jsonb_array_length(coalesce(p_linhas, '[]')) > 50000 then
    raise exception 'Linhas inválidas';
  end if;

  insert into public.banco_horas_execucoes (status, mensagem, periodo_inicio, periodo_fim)
  values (p_execucao->>'status', left(p_execucao->>'mensagem', 1000),
          nullif(p_execucao->>'periodo_inicio', '')::date, nullif(p_execucao->>'periodo_fim', '')::date)
  returning id into v_id;

  if p_execucao->>'status' = 'ok' then
    for l in select * from jsonb_array_elements(p_linhas) loop
      continue when privado.bh_normal(l->>'nome') is null or nullif(l->>'data', '') is null;
      insert into public.banco_horas_saldos (nome_norm, data, nome_vr, departamento, matricula, saldo_min, positivas_min,
          negativas_min, he50_min, he100_min, execucao_id)
      values (privado.bh_normal(l->>'nome'), (l->>'data')::date, upper(left(trim(l->>'nome'), 150)),
          upper(left(nullif(trim(l->>'departamento'), ''), 120)), left(nullif(trim(l->>'matricula'), ''), 30),
          coalesce((l->>'saldo_min')::int, 0), coalesce((l->>'positivas_min')::int, 0), coalesce((l->>'negativas_min')::int, 0),
          coalesce((l->>'he50_min')::int, 0), coalesce((l->>'he100_min')::int, 0), v_id)
      on conflict (nome_norm, data) do update set
          nome_vr = excluded.nome_vr, departamento = excluded.departamento, matricula = excluded.matricula,
          saldo_min = excluded.saldo_min, positivas_min = excluded.positivas_min, negativas_min = excluded.negativas_min,
          he50_min = excluded.he50_min, he100_min = excluded.he100_min, execucao_id = v_id, atualizado_em = now();
      v_n := v_n + 1;
    end loop;
    if jsonb_typeof(p_pendencias) = 'array' and nullif(p_execucao->>'periodo_inicio', '') is not null then
      delete from public.banco_horas_pendencias
       where data between (p_execucao->>'periodo_inicio')::date and coalesce(nullif(p_execucao->>'periodo_fim', '')::date, current_date);
      insert into public.banco_horas_pendencias (nome_norm, nome_vr, data, tipo, descricao, status, execucao_id)
      select privado.bh_normal(x->>'nome'), upper(left(trim(x->>'nome'), 150)), (x->>'data')::date,
             case when x->>'pendencia' ~* 'n[uú]mero errado|registro' then 'registro_faltando'
                  when x->>'pendencia' ~* 'falta' then 'falta'
                  when x->>'pendencia' ~* 'ajuste' then 'ajuste'
                  when x->>'pendencia' ~* 'abono' then 'abono' else 'outro' end,
             left(trim(x->>'pendencia'), 120), left(nullif(trim(x->>'status'), ''), 80), v_id
        from jsonb_array_elements(p_pendencias) x
       where privado.bh_normal(x->>'nome') is not null and nullif(x->>'data', '') is not null and nullif(trim(x->>'pendencia'), '') is not null;
    end if;
    select count(distinct nome_norm) into v_p from public.banco_horas_saldos where execucao_id = v_id;
    update public.banco_horas_execucoes set linhas = v_n, pessoas = v_p where id = v_id;
  end if;
  return jsonb_build_object('execucao_id', v_id, 'linhas', v_n, 'pessoas', v_p);
end $$;
revoke all on function public.banco_horas_receber(text, jsonb, jsonb, jsonb) from public;
grant execute on function public.banco_horas_receber(text, jsonb, jsonb, jsonb) to anon, authenticated;

-- pendência "em aberto": registro faltando / falta sempre; ajuste e abono só enquanto pendentes
create or replace function privado.bh_pend_aberta(p_tipo text, p_status text) returns boolean
language sql immutable set search_path = '' as $$
  select case when p_tipo in ('registro_faltando', 'falta') then coalesce(p_status, '') !~* 'aprovad|justificad|abonad'
              when p_tipo in ('ajuste', 'abono') then coalesce(p_status, '') ~* 'pendente'
              else false end
$$;
revoke all on function privado.bh_pend_aberta(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Leitura para a tela
-- ---------------------------------------------------------------------
create or replace function public.banco_horas_resumo(p_loja uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ult jsonb; v_ok jsonb; v_lin jsonb; v_sem jsonb; v_pend jsonb; v_mes date := date_trunc('month', current_date)::date;
begin
  if not privado.pode_em_alguma('colaborador.ler') then raise exception 'Acesso negado' using errcode = '42501'; end if;
  select to_jsonb(e) into v_ult from public.banco_horas_execucoes e order by e.executado_em desc limit 1;
  select to_jsonb(e) into v_ok from public.banco_horas_execucoes e where e.status = 'ok' order by e.executado_em desc limit 1;

  with ult as (
    select distinct on (s.nome_norm) s.*, privado.bh_colaborador(s.nome_norm) as colab
      from public.banco_horas_saldos s order by s.nome_norm, s.data desc),
  mes as (
    select s.nome_norm, sum(s.positivas_min) pos, sum(s.negativas_min) neg
      from public.banco_horas_saldos s where s.data >= v_mes group by s.nome_norm),
  sete as (   -- saldo de 7 dias antes do último dia lido
    select u.nome_norm,
           (select s.saldo_min from public.banco_horas_saldos s where s.nome_norm = u.nome_norm and s.data <= u.data - 7
             order by s.data desc limit 1) as saldo_7
      from ult u),
  pend as (
    select p.nome_norm, count(*) filter (where p.tipo in ('registro_faltando', 'falta')) as registros
      from public.banco_horas_pendencias p
     where p.data >= current_date - 7 and privado.bh_pend_aberta(p.tipo, p.status) group by p.nome_norm)
  select coalesce(jsonb_agg(jsonb_build_object(
           'nome_norm', u.nome_norm, 'nome_vr', u.nome_vr, 'departamento', u.departamento,
           'colaborador_id', c.id, 'colaborador_nome', c.nome_completo, 'loja_id', c.loja_atual_id, 'loja_nome', l.nome,
           'data', u.data, 'saldo_min', u.saldo_min,
           'mes_positivas_min', coalesce(m.pos, 0), 'mes_negativas_min', coalesce(m.neg, 0),
           'var7_min', u.saldo_min - st.saldo_7, 'registros_7d', coalesce(pd.registros, 0))
           order by u.saldo_min), '[]')
    into v_lin
    from ult u join public.colaboradores c on c.id = u.colab
    left join public.lojas l on l.id = c.loja_atual_id
    left join mes m on m.nome_norm = u.nome_norm
    left join sete st on st.nome_norm = u.nome_norm
    left join pend pd on pd.nome_norm = u.nome_norm
   where (p_loja is null or c.loja_atual_id = p_loja) and privado.pode('colaborador.ler', c.loja_atual_id);

  -- registros de ponto em aberto (últimos 35 dias)
  select coalesce(jsonb_agg(jsonb_build_object('colaborador_id', c.id, 'colaborador_nome', c.nome_completo, 'loja_nome', l.nome,
           'data', p.data, 'tipo', p.tipo, 'descricao', p.descricao, 'status', p.status) order by p.data desc, c.nome_completo), '[]')
    into v_pend
    from public.banco_horas_pendencias p
    join public.colaboradores c on c.id = privado.bh_colaborador(p.nome_norm)
    left join public.lojas l on l.id = c.loja_atual_id
   where p.data >= current_date - 35 and privado.bh_pend_aberta(p.tipo, p.status)
     and (p_loja is null or c.loja_atual_id = p_loja) and privado.pode('colaborador.ler', c.loja_atual_id);

  if privado.pode_em_alguma('colaborador.editar') then
    with ult as (select distinct on (s.nome_norm) s.* from public.banco_horas_saldos s order by s.nome_norm, s.data desc)
    select coalesce(jsonb_agg(jsonb_build_object('nome_norm', u.nome_norm, 'nome_vr', u.nome_vr, 'departamento', u.departamento,
             'data', u.data, 'saldo_min', u.saldo_min) order by u.nome_vr), '[]')
      into v_sem from ult u where privado.bh_colaborador(u.nome_norm) is null;
  end if;

  return jsonb_build_object('ultima_execucao', v_ult, 'ultima_ok', v_ok, 'linhas', v_lin, 'pendencias', v_pend,
                            'sem_vinculo', coalesce(v_sem, '[]'));
end $$;
revoke all on function public.banco_horas_resumo(uuid) from public, anon;
grant execute on function public.banco_horas_resumo(uuid) to authenticated;

-- histórico diário de uma pessoa (ficha / detalhe)
create or replace function public.banco_horas_historico(p_colaborador uuid, p_dias int default 60)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_dias int := least(greatest(p_dias, 1), 400);
begin
  if not privado.pode('colaborador.ler', privado.loja_do_colaborador(p_colaborador)) then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'dias', (select coalesce(jsonb_agg(jsonb_build_object('data', s.data, 'saldo_min', s.saldo_min, 'positivas_min', s.positivas_min,
              'negativas_min', s.negativas_min, 'he50_min', s.he50_min, 'he100_min', s.he100_min) order by s.data desc), '[]')
              from public.banco_horas_saldos s
             where privado.bh_colaborador(s.nome_norm) = p_colaborador and s.data >= current_date - v_dias),
    'pendencias', (select coalesce(jsonb_agg(jsonb_build_object('data', p.data, 'tipo', p.tipo, 'descricao', p.descricao, 'status', p.status,
              'aberta', privado.bh_pend_aberta(p.tipo, p.status)) order by p.data desc), '[]')
              from public.banco_horas_pendencias p
             where privado.bh_colaborador(p.nome_norm) = p_colaborador and p.data >= current_date - v_dias));
end $$;
revoke all on function public.banco_horas_historico(uuid, int) from public, anon;
grant execute on function public.banco_horas_historico(uuid, int) to authenticated;

-- vincular / desvincular nome do VR a um colaborador
create or replace function public.banco_horas_vincular(p_nome_norm text, p_colaborador uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_loja uuid;
begin
  if not exists (select 1 from public.banco_horas_saldos s where s.nome_norm = p_nome_norm) then
    raise exception 'Nome do VR não encontrado';
  end if;
  if p_colaborador is null then
    if not privado.pode_em_alguma('colaborador.editar') then raise exception 'Acesso negado' using errcode = '42501'; end if;
    delete from public.banco_horas_vinculos where nome_norm = p_nome_norm;
    return;
  end if;
  v_loja := privado.loja_do_colaborador(p_colaborador);
  if v_loja is null then raise exception 'Colaborador não encontrado'; end if;
  perform privado.exigir('colaborador.editar', v_loja);
  insert into public.banco_horas_vinculos (nome_norm, colaborador_id) values (p_nome_norm, p_colaborador)
  on conflict (nome_norm) do update set colaborador_id = excluded.colaborador_id, vinculado_por = auth.uid(), vinculado_em = now();
end $$;
revoke all on function public.banco_horas_vincular(text, uuid) from public, anon;
grant execute on function public.banco_horas_vincular(text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Pendência no Painel: robô sem atualizar há mais de 2 dias (ou com erro)
-- ---------------------------------------------------------------------
create or replace function privado.bh_horas(m int) returns text
language sql immutable set search_path = '' as $$
  select case when m < 0 then '-' when m > 0 then '+' else '' end || (abs(m) / 60) || 'h' || lpad((abs(m) % 60)::text, 2, '0')
$$;
revoke all on function privado.bh_horas(int) from public, anon, authenticated;

do $do$ declare d text; bloco text; begin
  d := pg_get_functiondef('public.painel_pendencias(uuid)'::regprocedure);
  if position('banco_horas' in d) > 0 then raise exception 'já aplicado'; end if;
  bloco := $b$

  -- Banco de horas: robô do VR parado ou com erro
  if exists (select 1 from public.banco_horas_execucoes) and privado.pode_em_alguma('colaborador.editar')
     and not exists (select 1 from public.banco_horas_execucoes e where e.status = 'ok' and e.executado_em > now() - interval '50 hours') then
    r := r || jsonb_build_object('chave', 'banco_horas_robo', 'titulo', 'Banco de horas do VR sem atualizar', 'gravidade', 'alta',
      'quantidade', 1, 'link', '/banco-horas', 'acao', 'Ver banco de horas',
      'itens', jsonb_build_array(jsonb_build_object('nome', 'Última tentativa',
        'detalhe', coalesce((select to_char(e.executado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || ' · ' ||
                    case when e.status = 'ok' then 'ok' else coalesce(e.mensagem, 'erro') end
                    from public.banco_horas_execucoes e order by e.executado_em desc limit 1), '—'),
        'link', '/banco-horas')));
  end if;

  -- Banco de horas: registro de ponto faltando / falta não justificada nos últimos 7 dias
  select count(*), coalesce(jsonb_agg(x) filter (where rn <= 6), '[]') into n, itens from (
    select jsonb_build_object('nome', c.nome_completo,
             'detalhe', count(*) || ' registro(s) em aberto · último em ' || to_char(max(p.data), 'DD/MM'),
             'link', '/banco-horas?pessoa=' || c.id) x,
           row_number() over (order by max(p.data) desc, c.nome_completo) rn
      from public.banco_horas_pendencias p join public.colaboradores c on c.id = privado.bh_colaborador(p.nome_norm)
     where p.data >= current_date - 7 and p.tipo in ('registro_faltando', 'falta') and privado.bh_pend_aberta(p.tipo, p.status)
       and (p_loja is null or c.loja_atual_id = p_loja) and privado.pode('colaborador.ler', c.loja_atual_id)
     group by c.id, c.nome_completo) s;
  if n > 0 then r := r || jsonb_build_object('chave', 'banco_horas_registros', 'titulo', 'Registro de ponto faltando (últimos 7 dias)', 'gravidade', 'media',
    'quantidade', n, 'link', '/banco-horas', 'acao', 'Ver banco de horas', 'itens', itens); end if;

  -- Banco de horas subindo: +2h ou mais nos últimos 7 dias
  select count(*), coalesce(jsonb_agg(x) filter (where rn <= 6), '[]') into n, itens from (
    select jsonb_build_object('nome', c.nome_completo,
             'detalhe', 'subiu ' || privado.bh_horas(q.var) || ' em 7 dias · saldo ' || privado.bh_horas(q.saldo_min),
             'link', '/banco-horas?pessoa=' || c.id) x,
           row_number() over (order by q.var desc) rn
      from (select u.nome_norm, u.saldo_min,
                   u.saldo_min - (select s.saldo_min from public.banco_horas_saldos s where s.nome_norm = u.nome_norm and s.data <= u.data - 7
                                   order by s.data desc limit 1) as var
              from (select distinct on (s.nome_norm) s.nome_norm, s.data, s.saldo_min from public.banco_horas_saldos s
                     where s.data >= current_date - 3 order by s.nome_norm, s.data desc) u) q
      join public.colaboradores c on c.id = privado.bh_colaborador(q.nome_norm)
     where q.var >= 120 and (p_loja is null or c.loja_atual_id = p_loja) and privado.pode('colaborador.ler', c.loja_atual_id)) s;
  if n > 0 then r := r || jsonb_build_object('chave', 'banco_horas_subindo', 'titulo', 'Banco de horas subindo (+2h ou mais em 7 dias)', 'gravidade', 'media',
    'quantidade', n, 'link', '/banco-horas', 'acao', 'Ver banco de horas', 'itens', itens); end if;
$b$;
  d := regexp_replace(d, '\nbegin\n', E'\nbegin\n' || replace(bloco, '\', '\\') || E'\n');
  if position('banco_horas' in d) = 0 then raise exception 'ponto de inserção não encontrado'; end if;
  execute d;
end $do$;

revoke all on function privado.bh_normal(text) from public, anon, authenticated;
