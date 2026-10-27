begin;
do $$ begin
  if not exists (select 1 from public.doc_categorias where codigo = 'atestados_medicos' and nivel_sigilo = 'saude' and nome = 'ATESTADOS MÉDICOS' and ativa) then
    raise exception 'FALHOU categoria de atestados';
  end if;
  raise notice 'ok  - categoria Atestados médicos (sigilo saúde)';
end $$;
select 'ATESTADOS OK';
rollback;
