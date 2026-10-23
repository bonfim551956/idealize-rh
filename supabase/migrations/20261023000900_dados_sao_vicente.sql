-- Dados de São Vicente informados pela empresa em 23/10/2026
update public.empresas
   set razao_social = 'Idealize Comercio Optico do Litoral LTDA', dados_confirmados = true, observacao = null
 where cnpj = '58849594000190';

update public.lojas
   set endereco = 'Rua Antonio Emerick, 481', telefone = '13982257862',
       observacao = 'CEP a completar', dados_confirmados = false
 where codigo = 'SAOVICENTE';
