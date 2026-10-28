-- VT: ajuste manual de dias a pagar
begin;
insert into auth.users (email) values ('dir@vt103.local'), ('ger@vt103.local');
select privado.bootstrap_diretoria('dir@vt103.local');
update public.usuarios set mfa_obrigatorio = true;
select (select id from public.usuarios where email='dir@vt103.local') as dir,
       (select id from public.usuarios where email='ger@vt103.local') as ger,
       (select id from public.lojas where codigo='SOROCABA') as sor \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',:'dir','aal','aal2')::text, true);
select public.conceder_acesso(:'ger','gerente_loja',:'sor');
select public.cadastrar_colaborador(jsonb_build_object('nome_completo','Gus Ferias','cpf','52998224725','loja_id',:'sor','matricula','1031',
  'tipo','clt_prazo_indeterminado','status_inicial','ativo','data_admissao','2025-02-07')) as gus \gset
select set_config('teste.gus', :'gus', false);
select public.vt_salvar(:'gus', true, 10.60, null);
select public.ausencia_registrar(jsonb_build_object('colaborador_id',:'gus','tipo','ferias','data_inicio','2026-11-02','data_fim','2026-11-11','aquisitivo_inicio','2025-02-07'));
do $$ declare r record; begin
  select * into r from public.vt_calculo('2026-11-01') where nome = 'GUS FERIAS';
  if r.dias_pagar <> 16 or r.dias_calculado <> 16 or r.ajuste_dias is not null then raise exception 'FALHOU calculo base: %', r; end if;
  begin perform public.vt_ajustar('2026-11-01', current_setting('teste.gus')::uuid, 25, ''); raise exception 'FALHOU sem motivo';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin perform public.vt_ajustar('2026-11-01', current_setting('teste.gus')::uuid, 40, 'teste'); raise exception 'FALHOU passou do mês';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  perform public.vt_ajustar('2026-11-01', current_setting('teste.gus')::uuid, 25, 'ferias ja pagas proporcionais');
  select * into r from public.vt_calculo('2026-11-01') where nome = 'GUS FERIAS';
  if r.dias_pagar <> 25 or r.valor <> 265 or r.dias_calculado <> 16 or r.ajuste_motivo <> 'FERIAS JA PAGAS PROPORCIONAIS' then raise exception 'FALHOU ajuste: %', r; end if;
  raise notice 'ok  - ajuste troca os dias a pagar, com motivo';
end $$;
select public.vt_fechar('2026-11-01', null, false);
do $$ declare r record; begin
  select * into r from public.vt_fechamentos where colaborador_id = current_setting('teste.gus')::uuid and mes = '2026-11-01';
  if r.dias_pagos <> 25 or r.dias_excluidos <> 9 or r.observacao not like '%AJUSTE MANUAL (16 → 25%' then raise exception 'FALHOU fechamento: %', r; end if;
  select * into r from public.vt_calculo('2026-12-01') where nome = 'GUS FERIAS';
  if r.dias_desconto_anterior <> 0 then raise exception 'FALHOU dezembro descontou de novo: %', r; end if;
  begin perform public.vt_ajustar('2026-11-01', current_setting('teste.gus')::uuid, null, null); raise exception 'FALHOU ajustou mês fechado';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  raise notice 'ok  - fechamento guarda o ajuste; mês seguinte não desconta de novo; mês fechado não muda';
end $$;
select set_config('request.jwt.claims', json_build_object('sub',:'ger','aal','aal2')::text, true);
do $$ begin
  begin perform public.vt_ajustar('2026-12-01', current_setting('teste.gus')::uuid, 20, 'gerente tentando'); raise exception 'FALHOU gerente ajustou';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin insert into public.vt_ajustes (mes, colaborador_id, dias_pagar, motivo) values ('2026-12-01', current_setting('teste.gus')::uuid, 1, 'xxx'); raise exception 'FALHOU insert direto';
  exception when insufficient_privilege then null; end;
  raise notice 'ok  - gerente não ajusta';
end $$;
reset role;
select 'VT AJUSTE OK';
rollback;
