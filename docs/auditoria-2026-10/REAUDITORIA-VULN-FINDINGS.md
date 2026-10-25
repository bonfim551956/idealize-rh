# Vuln findings (reaudit)

|id|sev|cat|loc|title|
|-|-|-|-|-|
|F-001|MEDIUM|pii-oracle|supabase/migrations/20261023000500_pessoas_regras_rls.sql:118|cadastrar_colaborador duplicate-CPF check is an unaudited CPF oracle without dados_pessoais.ler/MFA|
|F-002|MEDIUM|integrity|supabase/migrations/20261024000200_trava_campos_documento.sql:18|Approved documents' vencimento/competencia/nome/dates/observacoes editable by direct PATCH keeping 'aprovado'|
|F-003|MEDIUM|integrity|supabase/migrations/20261023000600_documentos.sql:207|status_assinatura / data_recebimento forgeable on INSERT via p_meta of documento_preparar_upload|
|F-004|MEDIUM|content-filter-bypass|supabase/functions/_shared/comum.ts:57|PDF active-content regex misses #xx-escaped names, compressed ObjStm, /AA /URI /SubmitForm etc.|
|F-005|MEDIUM|file-type-confusion|supabase/functions/documentos-upload/index.ts:49|Download filename keeps client extension, not detected type (polyglot .hta/.html/.pdf)|
|F-006|MEDIUM|privilege-escalation|supabase/migrations/20261023001800_mfa_por_usuario.sql:22|Non-MFA admin can disable owner's MFA requirement and revoke owner's diretoria|
|F-007|LOW|integrity|supabase/migrations/20261023000400_auditoria_timeline_tarefas.sql:164|INSERT into tarefas can forge criado_por/criado_em/chave_dedup/concluida_*|
|F-008|LOW|auth-bypass|supabase/migrations/20261023000600_documentos.sql:304|documento_arquivar ignores sigilo level|
|F-009|LOW|segregation-of-duties|supabase/migrations/20261023000600_documentos.sql:277|documento_conferir lets uploader approve own document|
|F-010|LOW|pii-oracle|supabase/migrations/20261023000500_pessoas_regras_rls.sql:200|atualizar_dados_pessoais unique-violation is cross-store CPF oracle|
|F-011|LOW|auth-bypass|supabase/migrations/20261023001200_cancelar_desligamento.sql:44|vinculo.status.alterar (no MFA) cancels/fakes termination processes requiring desligamento.gerir (MFA)|
|F-012|LOW|scope-confusion|supabase/functions/usuarios-convidar/index.ts:19|Invite function treats store-scoped acesso.gerir as global|
|F-013|LOW|privilege-escalation|supabase/migrations/20261023001700_supervisor_todas_lojas.sql:35|No-self-grant bypass via second invited account|
|F-014|LOW|auth-bypass|supabase/migrations/20261023000800_auth_storage.sql:8|Every auth signup becomes an active usuarios row (if public signup enabled)|
|F-015|LOW|integer-overflow|supabase/migrations/20261023001500_uniformes.sql:100|No upper bound on uniform quantity; int4 overflow bricks saldo and stock view|
|F-016|LOW|filename-sanitisation|supabase/functions/_shared/comum.ts:67|nomeSeguro keeps quotes/semicolon/RTL override|
|F-017|LOW|session-management|web/src/auth/AuthProvider.tsx:84|30-min idle logout not enforced after tab close|
