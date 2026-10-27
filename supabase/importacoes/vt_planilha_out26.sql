-- Importação da planilha CONTROLE DE AUSÊNCIA - REDE IDEALIZE (OUT/26) — roda como administrador (sem usuário logado)
-- 1) cadastro do VT (valor diário da fórmula de cada linha; home office = não recebe)
with v(nome, recebe, valor, obs) as (values
  ('GABRIEL JOSE MORAES DE OLIVEIRA', true, 10.60, null), ('FELIPE BARBOSA DA MOTA', true, 10.60, null),
  ('GUSTAVO HENRIQUE DE OLIVEIRA', true, 10.60, null), ('ISABELLY VITORIA PEREIRA DA SILVA', true, 10.60, null),
  ('THIAGO HENRIQUE PADILHA DA COSTA', true, 10.60, null), ('NATHAN FOLERINI DOS SANTOS', true, 10.60, null),
  ('LAIS VITORIA QUEIROZ NETO', true, 10.60, null), ('VALDNEA PEREIRA LEMES DOMINGUES', true, 10.60, null),
  ('ANA LAURA DOS SANTOS PEREIRA', true, 10.60, null), ('ALEXANDRA SANTOS DA SILVA', true, 10.60, null),
  ('IVISSON BISPO DOS SANTOS', true, 9.90, null), ('THAINA SILVA RIBEIRO', true, 9.90, null),
  ('MEIRE CRISTINA DOS SANTOS DE LIMA', true, 9.90, null), ('MARIANA SANTOS ROSA', true, 12.00, null),
  ('ALLISON HENRIQUE COELHO TAVARES DA SILVA', true, 12.00, null), ('LETICIA ANTUNES DA SILVA', true, 13.60, null),
  ('JANIELE COSTA BEZERRA DE SOUZA', true, 12.00, null), ('BEATRIZ DE CARVALHO SILVA', true, 12.00, null),
  ('JUAN DOUGLAS FAUSTINO', true, 12.00, null), ('CINTIA DA SILVA ALVES', true, 12.00, null),
  ('LICELIA SOUZA LEMES', true, 12.00, null), ('SARAH SUYANNE CORREA PEREIRA', true, 12.00, null),
  ('MARYSTELA BEATRIZ DOS SANTOS', true, 12.00, null),
  ('ANTONIO CARLOS DA SILVA TEIXEIRA', true, 12.80, null), ('EMILY FIGUEIREDO DE SOUZA SANTOS', true, 12.80, null),
  ('ERICA DE SOUZA RIBEIRO', true, 12.80, null), ('ADILMA BATISTA DA ROCHA', true, 12.80, null),
  ('GABRIELLY ALICE CAMPOS', true, 12.80, null),
  ('ANA FLAVIA DOS SANTOS MACHADO', false, null, 'HOME OFFICE'), ('THAYNA RIBEIRO DO NASCIMENTO', false, null, 'HOME OFFICE'),
  ('ANA FLÁVIA DOMINGUES DE OLIVEIRA', false, null, 'HOME OFFICE'))
insert into public.vt_cadastros (colaborador_id, recebe, valor_diario, observacao, atualizado_por)
select c.id, v.recebe, v.valor, coalesce(v.obs, 'IMPORTADO DA PLANILHA DE AUSÊNCIAS OUT/26'), null
  from v join public.colaboradores c on c.nome_completo = v.nome
on conflict (colaborador_id) do nothing;

-- 2) ausências de outubro (só de quem está no cadastro)
with a(nome, tipo, ini, fim, horario, obs) as (values
  ('ISABELLY VITORIA PEREIRA DA SILVA', 'falta_injustificada', date '2026-10-10', date '2026-10-10', null, 'PLANILHA OUT/26'),
  ('ALEXANDRA SANTOS DA SILVA', 'atestado', date '2026-10-06', date '2026-10-06', null, 'PLANILHA OUT/26'),
  ('JUAN DOUGLAS FAUSTINO', 'atestado', date '2026-10-16', date '2026-10-16', null, 'PLANILHA OUT/26 - 1 DIA'),
  ('EMILY FIGUEIREDO DE SOUZA SANTOS', 'atestado', date '2026-10-26', date '2026-10-26', null, 'PLANILHA OUT/26'),
  ('ADILMA BATISTA DA ROCHA', 'atestado', date '2026-10-03', date '2026-10-03', null, 'PLANILHA OUT/26'),
  ('ADILMA BATISTA DA ROCHA', 'atestado', date '2026-10-13', date '2026-10-13', null, 'PLANILHA OUT/26'),
  ('ADILMA BATISTA DA ROCHA', 'atestado', date '2026-10-15', date '2026-10-15', null, 'PLANILHA OUT/26'),
  ('ADILMA BATISTA DA ROCHA', 'declaracao_horas', date '2026-10-13', date '2026-10-13', '08H ÀS 09H15', 'PLANILHA OUT/26'),
  ('MARIANA SANTOS ROSA', 'declaracao_horas', date '2026-10-13', date '2026-10-13', '15H10 ÀS 16H', 'PLANILHA OUT/26'),
  ('MARIANA SANTOS ROSA', 'declaracao_horas', date '2026-10-19', date '2026-10-19', '15H40 ÀS 17H', 'PLANILHA OUT/26'),
  ('MARIANA SANTOS ROSA', 'declaracao_horas', date '2026-10-21', date '2026-10-21', '13H ÀS 14H30', 'PLANILHA OUT/26'),
  ('SARAH SUYANNE CORREA PEREIRA', 'declaracao_horas', date '2026-10-13', date '2026-10-13', '14H00 ÀS 14H50', 'PLANILHA OUT/26'))
insert into public.ausencias (colaborador_id, tipo, data_inicio, data_fim, horario, observacao, criado_por)
select c.id, a.tipo::public.ausencia_tipo, a.ini, a.fim, a.horario, a.obs, null
  from a join public.colaboradores c on c.nome_completo = a.nome;

-- 3) fechamento de OUT/26 como foi pago pela planilha (dias e valor da planilha).
--    dias_excluidos = dias que a planilha já tirou (base da planilha − dias pagos),
--    para novembro não descontar de novo o que outubro já descontou.
with f(nome, valor_diario, base, dias, valor) as (values
  ('GABRIEL JOSE MORAES DE OLIVEIRA', 10.60, 27, 27, 286.20), ('FELIPE BARBOSA DA MOTA', 10.60, 27, 27, 286.20),
  ('GUSTAVO HENRIQUE DE OLIVEIRA', 10.60, 27, 10, 106.00), ('ISABELLY VITORIA PEREIRA DA SILVA', 10.60, 27, 26, 275.60),
  ('THIAGO HENRIQUE PADILHA DA COSTA', 10.60, 27, 27, 286.20), ('NATHAN FOLERINI DOS SANTOS', 10.60, 27, 27, 286.20),
  ('LAIS VITORIA QUEIROZ NETO', 10.60, 27, 27, 286.20), ('VALDNEA PEREIRA LEMES DOMINGUES', 10.60, 21, 21, 222.60),
  ('ANA LAURA DOS SANTOS PEREIRA', 10.60, 23, 23, 243.80), ('ALEXANDRA SANTOS DA SILVA', 10.60, 27, 24, 254.40),
  ('IVISSON BISPO DOS SANTOS', 9.90, 27, 27, 267.30), ('THAINA SILVA RIBEIRO', 9.90, 27, 27, 267.30),
  ('MEIRE CRISTINA DOS SANTOS DE LIMA', 9.90, 27, 27, 267.30), ('MARIANA SANTOS ROSA', 12.00, 27, 27, 324.00),
  ('ALLISON HENRIQUE COELHO TAVARES DA SILVA', 12.00, 27, 27, 324.00), ('LETICIA ANTUNES DA SILVA', 13.60, 27, 27, 367.20),
  ('JANIELE COSTA BEZERRA DE SOUZA', 12.00, 25, 25, 300.00), ('BEATRIZ DE CARVALHO SILVA', 12.00, 25, 25, 300.00),
  ('JUAN DOUGLAS FAUSTINO', 12.00, 25, 24, 288.00), ('CINTIA DA SILVA ALVES', 12.00, 25, 25, 300.00),
  ('LICELIA SOUZA LEMES', 12.00, 25, 25, 300.00), ('SARAH SUYANNE CORREA PEREIRA', 12.00, 25, 25, 300.00),
  ('MARYSTELA BEATRIZ DOS SANTOS', 12.00, 25, 25, 300.00),
  ('ANTONIO CARLOS DA SILVA TEIXEIRA', 12.80, 27, 27, 345.60), ('EMILY FIGUEIREDO DE SOUZA SANTOS', 12.80, 27, 27, 345.60),
  ('ERICA DE SOUZA RIBEIRO', 12.80, 27, 27, 345.60), ('ADILMA BATISTA DA ROCHA', 12.80, 27, 27, 345.60),
  ('GABRIELLY ALICE CAMPOS', 12.80, 27, 25, 320.00))
insert into public.vt_fechamentos (mes, colaborador_id, loja_id, valor_diario, dias_base, dias_excluidos,
                                   dias_desconto_anterior, dias_pagos, valor, origem, observacao, fechado_por)
select date '2026-10-01', c.id, c.loja_atual_id, f.valor_diario, f.base, f.base - f.dias, 0, f.dias, f.valor,
       'planilha', 'IMPORTADO DA PLANILHA CONTROLE DE AUSÊNCIA OUT/26', null
  from f join public.colaboradores c on c.nome_completo = f.nome;

-- 4) linha do tempo das ausências importadas
select privado.timeline(a.colaborador_id, null, 'ausencia', a.data_inicio,
  case a.tipo when 'falta_injustificada' then 'FALTA INJUSTIFICADA' when 'atestado' then 'ATESTADO' else 'DECLARAÇÃO DE HORAS' end
    || ' EM ' || to_char(a.data_inicio, 'DD/MM/YYYY'),
  a.horario, case when a.tipo = 'atestado' then 'saude' else 'contratual' end)
  from public.ausencias a where a.observacao like 'PLANILHA OUT/26%';
