# IDEALIZE RH 360º — Gestão de Pessoas & Departamento Pessoal

Status: **Etapa 1 — banco, segurança e interface prontos. Falta publicar a interface na Vercel (passo manual abaixo).**

- Supabase: projeto `idealize-RH` (`ifqaukdkurkirmahpuky`), organização **SDR COM IA**, região São Paulo (sa-east-1)
- Banco: 11 migrações aplicadas · Edge Functions: `documentos-upload`, `documentos-acesso`, `usuarios-convidar` · Bucket privado: `documentos`
- Interface: pasta `web/` (React + Vite + Tailwind + Radix + Lucide + Framer Motion)

## Estrutura

```
supabase/
  migrations/      8 migrações versionadas (aplicadas em produção nesta ordem)
  functions/       Edge Functions (upload e download de documentos)
    _shared/       utilitários (validação de arquivo, CORS, clientes)
    tests/         testes de validação de arquivos (Deno)
  tests/
    00_stub_supabase.sql          simula o Supabase num Postgres local
    10_seguranca_regras.sql       77 testes de segurança e regras
    remoto/                       mesma bateria para rodar no projeto real (desfaz tudo ao final)
    run_local.sh                  recria o banco local, aplica migrações e roda os testes
```

## Arquitetura (resumo)

| Camada | Como funciona |
|---|---|
| Empregador × loja | `empresas` (CNPJ) ≠ `lojas` (unidade). Vínculo CLT é com a empresa; a loja é a lotação. |
| Autorização | `usuário → atribuição (perfil + loja opcional) → permissões`. Toda regra passa por `privado.pode(permissao, loja)` dentro do banco (RLS + funções). A tela nunca é a barreira. |
| MFA | Permissões sensíveis (salário, saúde, dados pessoais completos, auditoria, conceder acesso) só valem em sessão com MFA (AAL2). |
| Escrita | Colaboradores, vínculos, lotação, cargos, salários e status de documentos **só mudam por funções** que validam permissão e regra. INSERT/UPDATE/DELETE direto pela API é bloqueado. |
| Dados pessoais | CPF completo, nascimento e endereço não saem em consultas comuns (só `cpf_mascarado`). Leitura completa via `colaborador_dados_pessoais()`, auditada. |
| Documentos | Bucket privado sem nenhum acesso direto. Upload/download só pelas Edge Functions, que checam permissão no banco e geram URL assinada de 60 s. Tipo real do arquivo validado pelo conteúdo; PDF com JavaScript recusado; SHA-256 e versões guardados. |
| Auditoria | `audit_log` append-only (nem o dono do banco altera). Registra alterações, leitura de dados pessoais, downloads e **tentativas negadas**. |
| Exclusão | Não existe exclusão de colaborador, vínculo ou documento. Desligado continua no sistema; documento é arquivado. |

## Perfis iniciais

| Perfil | Escopo | Resumo |
|---|---|---|
| Diretoria / RH central | todas as lojas | tudo (sensíveis com MFA) |
| Departamento Pessoal | todas | tudo, exceto gerir acessos, auditoria, config e jurídico |
| Gerente de loja | **só a própria loja** | cadastro básico, documentos de sigilo "geral", tarefas, dashboard |
| Contabilidade (externa) | por loja atribuída | dados pessoais, salário, documentos pessoais/contratuais/financeiros |
| Jurídico | por loja atribuída | leitura ampla |
| Administrador técnico | global | só estrutura (lojas, cargos, categorias). **Não vê pessoas nem documentos. Não concede acessos.** |
| Colaborador | — | portal na Etapa 5 |

## O que está funcional e validado (77 testes, local e no banco real)

- Cadastro das 4 empresas/lojas; cadastro de nova loja por usuário autorizado
- Cadastro de colaborador (validação de CPF, sem duplicidade) com vínculo, lotação, cargo e salário
- Isolamento entre lojas: gerente de uma loja não vê colaborador, vínculo, lotação, documento nem arquivo de outra — nem sabendo o ID
- Transferência entre lojas da mesma empresa com histórico; **entre CNPJs diferentes, bloqueada** (pendente de validação contábil)
- Máquina de estados do vínculo; "desligado" só com processo de desligamento concluído
- Promoções/mudança de função com histórico; alteração salarial com histórico e auditoria
- Documentos: enviado ≠ aprovado; conferência obrigatória; versões; permissão por nível de sigilo
- Linha do tempo do colaborador respeitando sigilo
- Dashboard com números reais, respeitando o escopo de quem consulta
- Auditoria imutável, incluindo tentativas negadas

## Pendente

**Etapa 1 (falta para fechar):**
- Publicar a pasta `web/` na Vercel (o conector da Vercel desta conta é só leitura)
- Configurações no painel do Supabase (não acessíveis pelo conector): **desligar cadastro público (signup)**, confirmar MFA TOTP ativo, URL do site para recuperação de senha
- Definir `ORIGENS_PERMITIDAS` (domínio do app) nas Edge Functions
- Teste ponta a ponta das Edge Functions com usuário real (código validado por tipagem e testes unitários; banco validado)

**Etapas seguintes:** admissão com checklist, contratos e prazos, férias, afastamentos, ponto, desligamento completo, alertas (pg_cron), notificações, obrigações, modelos, retenção, assinatura eletrônica, recrutamento, treinamentos, comunicados, equipamentos, portal do colaborador.

**Limpeza agendada (Etapa 2):** versões de documento não confirmadas em 24 h.

**Risco conhecido:** sem antivírus nos uploads (mitigado por validação de tipo real e bloqueio de PDF ativo). Proposta: ClamAV em Cloud Run.

## Pendências de validação jurídica/contábil

- Prazos de retenção de cada categoria (todos marcados como provisórios)
- Transferência entre CNPJs do grupo
- Modalidades de desligamento e checklist
- Regras de férias/convenção coletiva por cidade
- Razão social completa de São Vicente (CNPJ 58.849.594/0001-90) e CEP da loja

## Primeiro acesso (bootstrap)

1. No painel do Supabase → Authentication → Users → *Add user* (seu e-mail).
2. No SQL Editor: `select privado.bootstrap_diretoria('seu@email.com');` (funciona uma única vez).
3. Ative o MFA no primeiro login; a partir daí os demais acessos são concedidos pelo sistema.

## Rodar os testes localmente

Requer PostgreSQL 16+: `supabase/tests/run_local.sh` (porta 5499, socket em /tmp).

## Publicar a interface na Vercel

O jeito mais simples (igual ao PDV):

1. Crie um repositório no GitHub (ex.: `idealize-rh`) e envie a pasta `web/` como raiz.
2. Na Vercel: *Add New → Project → Import* esse repositório. Framework: **Vite**. Build: `npm run build`. Saída: `dist`.
3. Em *Environment Variables* adicione:
   - `VITE_SUPABASE_URL` = `https://ifqaukdkurkirmahpuky.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = `sb_publishable_K0XKMUMbZoWD1nP54G8tpA_b3fm5ZUr` (chave pública, feita para o navegador)
4. Deploy. Anote o endereço (ex.: `https://idealize-rh.vercel.app`).

Alternativa sem GitHub: na pasta `web/`, rode `npx vercel --prod` e siga as perguntas.

### Depois de publicar — no painel do Supabase (Authentication)
- **URL Configuration → Site URL**: o endereço da Vercel. **Redirect URLs**: `https://SEU-ENDERECO/definir-senha`
- **Sign In / Providers → Email**: desligar *Allow new users to sign up* (só entra quem for convidado)
- **Multi-Factor**: confirmar TOTP habilitado
- **Senha**: mínimo de 10 caracteres
- E-mails: o envio padrão do Supabase tem limite baixo por hora; para muitos convites, configurar SMTP próprio.

### Primeiro acesso
1. Supabase → Authentication → Users → *Add user → Create new user* (seu e-mail + senha, marcar *Auto Confirm*).
2. Peça para rodar `select privado.bootstrap_diretoria('seu@email');` (ou rode no SQL Editor).
3. Entre no sistema: ele pede para ativar a verificação em duas etapas (app autenticador). A partir daí, convide os demais em *Usuários e acessos*.

### Interface — o que tem
Login, recuperação e criação de senha, verificação em duas etapas obrigatória para perfis sensíveis, encerramento por inatividade (30 min),
painel com indicadores reais, colaboradores (lista, filtros, cadastro), ficha (visão geral, dados pessoais revelados sob auditoria, movimentações,
documentos, linha do tempo), ações (situação, transferência, promoção, salário, desligamento), documentos (envio múltiplo, conferência, versões,
arquivamento, visualização por link de 60 s), lojas e cargos, usuários e acessos (convite, concessão por loja, revogação), auditoria e minha conta.
Cabeçalhos de segurança (CSP, HSTS, X-Frame-Options) em `web/vercel.json`.
