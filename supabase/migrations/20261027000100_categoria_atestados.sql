-- =====================================================================
-- IDEALIZE RH 360º — Categoria própria para atestado médico
-- Antes o atestado ficava dentro de "Afastamentos e licenças" e não
-- aparecia com esse nome no envio. Mesmo sigilo (saúde): só DP, RH
-- central e diretoria enviam e veem.
-- =====================================================================
insert into public.doc_categorias (codigo, nome, nivel_sigilo, exige_vencimento, exige_competencia, retencao_observacao, dica_ia)
values ('atestados_medicos', 'Atestados médicos', 'saude', false, false,
        'Prazo de retenção a validar com contabilidade/jurídico',
        'Atestado médico ou odontológico de afastamento por dias ou horas, declaração de comparecimento a consulta ou exame. Data de emissão: data do atestado')
on conflict (codigo) do nothing;

update public.doc_categorias
   set dica_ia = 'Licença-maternidade/paternidade, comunicação ou perícia do INSS, auxílio-doença, CAT (comunicação de acidente de trabalho), afastamentos longos. Atestado médico simples vai em Atestados médicos'
 where codigo = 'afastamentos_licencas';
