-- Crachá só é pedido depois do período de experiência: enquanto o contrato for de
-- experiência, a falta do crachá não entra nas pendências de admissão do painel.
do $$
declare d text := pg_get_functiondef('public.painel_pendencias(uuid)'::regprocedure); n int;
  t text[] := array[
    'join lateral (select v.status, v.data_admissao from public.vinculos v where v.colaborador_id = c.id',
    'join lateral (select v.status, v.data_admissao, v.tipo from public.vinculos v where v.colaborador_id = c.id',
    'from privado.admissao_itens_situacao(c.id) s where not s.concluido) as faltam',
    'from privado.admissao_itens_situacao(c.id) s where not s.concluido and not (s.item = ''cracha'' and v.tipo = ''clt_experiencia'')) as faltam'];
begin
  for i in 1..array_length(t, 1) by 2 loop
    n := (length(d) - length(replace(d, t[i], ''))) / length(t[i]);
    if n <> 1 then raise exception 'painel_pendencias mudou: trecho não encontrado: %', t[i]; end if;
    d := replace(d, t[i], t[i+1]);
  end loop;
  execute d;
end $$;
