# Reauditoria de segurança — IDEALIZE RH 360º (25/10/2026)

Varredura completa refeita no código com as 4 correções já aplicadas (8 áreas, 60 arquivos), triagem adversarial de cada achado e conferência direta no banco de produção.

## 1. As 4 correções da auditoria anterior

| Correção | Situação na reauditoria |
|---|---|
| Busca por CPF (`localizar_colaborador_por_cpf`) | **Fechada.** Exige dados pessoais, é auditada. A classificação por IA chama a função com o login do usuário (não com a chave de serviço). Os outros caminhos de "oráculo de CPF" encontrados (cadastro e edição de dados pessoais) só estão disponíveis para perfis que já veem o CPF completo. |
| Trava dos campos do documento | **Fechada.** Autoria, assinatura e conferência não mudam mais por fora das funções. Nome, datas e observações continuam editáveis de propósito (decisão de projeto, coberta por teste). |
| Confirmação de upload | **Fechada.** Exige o arquivo no armazenamento, bloqueia arquivado e versão antiga; o caminho do arquivo é gerado pelo servidor e não pode ser escolhido pelo usuário. |
| Trava das tarefas | **Incompleta.** Valia só para alteração (UPDATE). Pela criação direta (INSERT) ainda dava para gravar autoria, datas e conclusão falsas. **Correção pronta** (ver 2.1). |

## 2. Achados novos confirmados (3)

### 2.1 [BAIXO] Criação de tarefa com autoria/conclusão forjadas
`supabase/migrations/20261023000400_auditoria_timeline_tarefas.sql:164`. Quem tem `tarefa.gerir` numa loja podia criar uma tarefa "criada pela diretoria e concluída pelo RH" com datas retroativas. A trilha de auditoria ainda registrava o autor real.
**Correção:** `20261025000100_trava_tarefas_insercao.sql` — o trigger passa a valer também na criação: o servidor grava autoria, datas, origem e conclusão. Teste `94_correcoes_reauditoria.sql`.

### 2.2 [MÉDIO] Arquivo baixado com a extensão escolhida por quem enviou
`supabase/functions/documentos-upload/index.ts:49`. O tipo é validado pelo conteúdo, mas o nome do arquivo mantinha a extensão do cliente. Um arquivo com cabeçalho de imagem chamado `holerite.hta` (ou com o caractere invisível que inverte o texto, U+202E) era baixado pelo RH com essa extensão — no Windows, um `.hta` executa código.
**Correção:** nova função `nomeComExtensao` — a extensão passa a ser sempre a do tipo real detectado (`.pdf`, `.jpg`, `.png`, `.webp`), e caracteres invisíveis, aspas e ponto e vírgula são removidos. Aplicada no envio e também no download (protege registros antigos).

### 2.3 [BAIXO] Logout por inatividade não valia ao fechar a aba
`web/src/auth/AuthProvider.tsx:84`. O limite de 30 minutos era só um cronômetro na aba aberta. Fechando o navegador sem clicar em "Sair", quem abrisse o sistema horas depois no mesmo computador da loja entrava logado.
**Correção:** a última atividade fica gravada no navegador (compartilhada entre abas); ao abrir o sistema ou voltar à aba, se passou de 30 minutos a sessão é encerrada antes de mostrar qualquer dado.

## 3. Higiene encontrada no banco de produção
- As tabelas de uniformes tinham o privilégio padrão de leitura para usuários não logados. O RLS bloqueava (nenhum dado vazava), mas o privilégio é removido na mesma migração para ficar igual às demais tabelas.
- Supabase Security Advisor: as 24 funções executáveis por usuários logados são intencionais (todas checam permissão e têm `search_path` fixo). Continua o aviso **"Leaked password protection disabled"** — ligar no painel.
- Conferido: todas as views com `security_invoker`, todas as funções com `search_path` fixo, bucket `documentos` privado e sem nenhuma política de acesso direto.

## 4. Descartados na triagem (13)
| Achado | Por que foi descartado |
|---|---|
| Oráculo de CPF no cadastro de colaborador | Só DP/RH/diretoria cadastram, e esses perfis já veem o CPF completo |
| Oráculo de CPF na edição de dados pessoais | Exige combinação de perfis atípica e centenas de alterações auditadas em um CPF real |
| Edição de vencimento/nome de documento aprovado | Comportamento intencional (decisão de projeto, coberto por teste) |
| Status de assinatura informado no envio | Declaração do próprio remetente, conferida na aprovação |
| Filtro de PDF por expressão regular | Endurecimento; sem caminho concreto além do sandbox do leitor de PDF |
| Admin sem MFA desliga o MFA do dono | `rh_central` já tem todas as permissões; consequência da decisão de MFA só no dono |
| Arquivar documento jurídico sem ler | Impossível descobrir o identificador do documento |
| Quem envia aprova o próprio documento | Intencional para equipe pequena (separação por perfil) |
| Status do vínculo cancela desligamento | Todo perfil com uma permissão tem a outra |
| Convite com acesso.gerir por loja | Conta convidada nasce sem nenhum acesso |
| Autoconcessão via segunda conta | Administrador já pode conceder qualquer perfil |
| Cadastro público cria usuário ativo | Depende de cadastro público ligado (README manda desligar); usuário nasce sem acesso |
| Estouro de soma no estoque de uniformes | Só perfis administrativos dão entrada |

## 5. Recomendações que continuam fora do código
1. Ligar a proteção contra senhas vazadas (Supabase → Authentication → Passwords).
2. Avaliar MFA para quem tem `rh_central`/`acesso.gerir` (hoje o principal risco residual: com só a senha de um RH central dá para administrar acessos).
3. Configurar no Supabase limite de tempo de sessão / inatividade (Authentication → Sessions), reforçando o item 2.3 no servidor.
4. Definir `ORIGENS_PERMITIDAS` nas Edge Functions com os dois domínios do sistema.
5. Conferir que o cadastro público (signup) está desligado.
