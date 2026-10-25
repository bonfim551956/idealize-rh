# VULN-FINDINGS — Idealize RH 360º

Static scan, 2026-10-24T19:40:43.150719Z. {'total': 19, 'high': 1, 'medium': 5, 'low': 13, 'low_confidence': 3}

| id | severity | category | file:line | title |
|---|---|---|---|---|
| F-001 | MEDIUM | tampering | supabase/migrations/20261023000600_documentos.sql:147 | documentos_editar UPDATE policy lets enviar-holders forge attribution, signature status and dates on approved documents |
| F-002 | HIGH | info-disclosure | supabase/migrations/20261023001400_classificacao_ia.sql:35 | Full CPF recoverable via cpf_mascarado + localizar_colaborador_por_cpf oracle by roles without dados_pessoais.ler |
| F-003 | MEDIUM | file-upload-filter-bypass | supabase/functions/_shared/comum.ts:55 | PDF active-content regex filter bypassable (#xx name escapes, compressed object streams, unlisted /AA /URI /SubmitForm) |
| F-004 | MEDIUM | integrity | supabase/migrations/20261023000600_documentos.sql:233 | Upload RPCs callable directly: file-less 'confirmed' versions with forged hash/MIME; confirm can roll back or un-archive documents |
| F-005 | MEDIUM | auth-bypass | supabase/migrations/20261023001800_mfa_por_usuario.sql:19 | Per-user MFA flag makes every exige_mfa permission (incl. acesso.gerir) password-only for all non-owner accounts |
| F-006 | MEDIUM | privilege-escalation | supabase/migrations/20261023001700_supervisor_todas_lojas.sql:35 | Access-management has no grant ceiling and no protection of the owner (revoke / disable owner's MFA) |
| F-007 | LOW | authorization | supabase/migrations/20261023000400_auditoria_timeline_tarefas.sql:168 | tarefas UPDATE policy lets assignee move a task to any store and forge origem/concluida_por/chave_dedup |
| F-008 | LOW | info-disclosure | supabase/migrations/20261023000500_pessoas_regras_rls.sql:118 | cadastrar_colaborador / atualizar_dados_pessoais reveal CPF existence across stores |
| F-009 | LOW | audit-forgery | supabase/migrations/20261023001400_classificacao_ia.sql:48 | registrar_sugestao_ia lets any active user write arbitrary CLASSIFICACAO_IA audit entries for any store |
| F-010 | LOW | info-disclosure | supabase/migrations/20261023000500_pessoas_regras_rls.sql:249 | transferir_colaborador validates before authorizing -> store-location oracle for any employee UUID |
| F-011 | LOW | info-disclosure | supabase/migrations/20261023000600_documentos.sql:261 | Timeline gates document titles by the employee's current store, not the document's store |
| F-012 | LOW | authorization | supabase/migrations/20261023000600_documentos.sql:304 | documento_arquivar does not check the category sigilo permission |
| F-013 | LOW | tampering | supabase/migrations/20261023000500_pessoas_regras_rls.sql:63 | status_transicoes writable by admin_tecnico (config.estrutura.gerir), rewriting the employment state machine |
| F-014 | LOW | auth | supabase/migrations/20261023000800_auth_storage.sql:11 | Any new auth user becomes an active usuarios row with self-chosen name if public signup is enabled |
| F-015 | LOW | integer-overflow | supabase/migrations/20261023001600_perfil_supervisor.sql:71 | Uniform ledger sum cast to integer can overflow, bricking an item and the stock view |
| F-016 | LOW | prompt-injection | web/src/pages/EnvioDocumentos.tsx:133 | LLM suggestions pre-fill category/employee and batch upload sends them in one click |
| F-017 | LOW | session-management | web/src/pages/Admin.tsx:392 | Password change needs only the session (no current password / reauth) |
| F-018 | LOW | auth | supabase/functions/usuarios-convidar/index.ts:35 | Invite redirect falls back to the request Origin header when SITE_URL is unset |
| F-019 | LOW | info-disclosure | supabase/migrations/20261023001600_perfil_supervisor.sql:69 | privado SECURITY DEFINER helpers executable by authenticated; only reachable if privado schema is exposed |

### F-001 — documentos_editar UPDATE policy lets enviar-holders forge attribution, signature status and dates on approved documents
- **Severity:** MEDIUM · **Confidence:** 0.85 · **Location:** `supabase/migrations/20261023000600_documentos.sql:147` · scanner F-03-01

**Description.** Table-wide UPDATE remains for authenticated; travar_documento locks only status, conferido_por, versao_atual, loja_id, colaborador_id, categoria_id. enviado_por, criado_por, criado_em, conferido_em, status_assinatura, vencimento, competencia, observacoes are freely writable; approval is not reset. documento_preparar_upload also takes status_assinatura from p_meta (line 207).

**Exploit scenario.** PATCH /rest/v1/documentos?id=eq.<contract> {status_assinatura:'assinado', enviado_por:<HR uuid>, vencimento:'2030-01-01', observacoes:'OK'} — unsigned contract shows signed and HR-sent, expiry alerts suppressed, rejection notes erased.

**Recommendation.** Revoke UPDATE on documentos from authenticated and grant UPDATE only on (nome, observacoes) or extend travar_documento to all integrity columns; ignore status_assinatura from p_meta.

### F-002 — Full CPF recoverable via cpf_mascarado + localizar_colaborador_por_cpf oracle by roles without dados_pessoais.ler
- **Severity:** HIGH · **Confidence:** 0.8 · **Location:** `supabase/migrations/20261023001400_classificacao_ia.sql:35` · scanner F-01-01 (dup F-04-01)

**Description.** cpf_mascarado (20261023000500_pessoas_regras_rls.sql:10-12) shows digits 4-9; check digits derive from digits 1-9, so each masked CPF has 1000 valid candidates. localizar_colaborador_por_cpf (SECURITY DEFINER, granted to authenticated) compares against raw c.cpf requiring only colaborador.ler (no MFA, no audit), bypassing colaborador.dados_pessoais.ler (exige_mfa) and the LER_DADOS_PESSOAIS audit in colaborador_dados_pessoais.

**Exploit scenario.** gerente_loja/supervisor reads cpf_mascarado, enumerates 1000 candidates via POST /rest/v1/rpc/localizar_colaborador_por_cpf; the one returning a row is the full CPF. Repeat for every employee in scope; no audit trail.

**Recommendation.** Require privado.pode('colaborador.dados_pessoais.ler', loja) in the RPC (or revoke from authenticated and call it with service role from the edge function after checks); audit each lookup; consider a stronger mask.

### F-003 — PDF active-content regex filter bypassable (#xx name escapes, compressed object streams, unlisted /AA /URI /SubmitForm)
- **Severity:** MEDIUM · **Confidence:** 0.8 · **Location:** `supabase/functions/_shared/comum.ts:55` · scanner F-03-02

**Description.** pdfSuspeito runs a raw-bytes regex for /JavaScript|JS|Launch|EmbeddedFile|OpenAction. Hex-escaped names (/J#61vaScript), FlateDecode ObjStm, and keys like /AA, /SubmitForm, /URI, /GoToR, /RichMedia, /XFA evade it. Files are later opened by HR via signed URL.

**Exploit scenario.** Upload a PDF with OpenAction/JavaScript inside a compressed ObjStm; HR downloads and opens in Acrobat, script runs (phishing/SubmitForm exfil). Browser same-origin impact unlikely (supabase.co origin, sandboxed viewer).

**Recommendation.** Parse with a real PDF library (inflate streams, normalize names) and reject active keys, or flatten/re-render PDFs server-side; serve with download disposition.

### F-004 — Upload RPCs callable directly: file-less 'confirmed' versions with forged hash/MIME; confirm can roll back or un-archive documents
- **Severity:** MEDIUM · **Confidence:** 0.7 · **Location:** `supabase/migrations/20261023000600_documentos.sql:233` · scanner F-03-03

**Description.** documento_preparar_upload/confirmar_upload are granted to authenticated. Direct calls skip the edge function: mime/size/sha256 are client-supplied; confirm does not verify the storage object exists, does not reject archived docs, and does not require v.versao > versao_atual; it sets status='recebido' and clears conferência.

**Exploit scenario.** Prepare v2 without uploading; later after v3 approved and archived, confirm v2 -> archived approved doc returns to 'recebido' pointing at a non-existent file.

**Recommendation.** Revoke both RPCs from authenticated and call them from the edge function with service role passing the verified user id; in confirm reject archived docs and stale versions and check storage.objects.

### F-005 — Per-user MFA flag makes every exige_mfa permission (incl. acesso.gerir) password-only for all non-owner accounts
- **Severity:** MEDIUM · **Confidence:** 0.7 · **Location:** `supabase/migrations/20261023001800_mfa_por_usuario.sql:19` · scanner F-02-01

**Description.** privado.sessao_aal2() returns true when the caller's usuarios.mfa_obrigatorio is false (default false). privado.pode and minhas_permissoes rely on it, so acesso.gerir, remuneracao.*, dados_pessoais.*, desligamento.gerir and saude/financeiro/disciplinar/juridico document permissions work at AAL1. rh_central holds acesso.gerir.

**Exploit scenario.** Phished rh_central password -> invite attacker email, conceder_acesso(diretoria), definir_mfa_obrigatorio(owner,false), read all salaries/health docs; no TOTP ever requested.

**Recommendation.** Keep the per-user relaxation but exclude the access-control plane: acesso.gerir (and ideally auditoria.ler) must always require a real aal2; or auto-force mfa_obrigatorio=true for holders of profiles with acesso.gerir.

### F-006 — Access-management has no grant ceiling and no protection of the owner (revoke / disable owner's MFA)
- **Severity:** MEDIUM · **Confidence:** 0.6 · **Location:** `supabase/migrations/20261023001700_supervisor_todas_lojas.sql:35` · scanner F-02-02

**Description.** conceder_acesso only blocks self-grant; any acesso.gerir holder can grant diretoria/rh_central globally without expiry to a second account they invite; revogar_acesso and definir_mfa_obrigatorio can target the owner.

**Exploit scenario.** Temporary rh_central invites alt account, grants it diretoria without expiry, revokes owner's diretoria and turns off owner's MFA requirement.

**Recommendation.** Only diretoria (at aal2) may grant diretoria/rh_central/acesso.gerir or act on diretoria holders; cap valido_ate at caller's own; never allow mfa_obrigatorio=false for acesso.gerir holders.

### F-007 — tarefas UPDATE policy lets assignee move a task to any store and forge origem/concluida_por/chave_dedup
- **Severity:** LOW · **Confidence:** 0.6 · **Location:** `supabase/migrations/20261023000400_auditoria_timeline_tarefas.sql:168` · scanner F-05-01

**Description.** tarefas_editar WITH CHECK accepts responsavel_id = auth.uid() with no column limits and no store check on the new loja_id; colaborador_id not tied to loja_id.

**Exploit scenario.** Campinas manager creates a task, PATCHes it to Sorocaba with origem='sistema' and a phishing title; Sorocaba sees a fake system task.

**Recommendation.** Require tarefa.gerir in the new loja_id in WITH CHECK; trigger locking origem, chave_dedup, criado_por; server-set concluida_por; validate colaborador store.

### F-008 — cadastrar_colaborador / atualizar_dados_pessoais reveal CPF existence across stores
- **Severity:** LOW · **Confidence:** 0.6 · **Location:** `supabase/migrations/20261023000500_pessoas_regras_rls.sql:118` · scanner F-01-02

**Description.** Global duplicate-CPF check returns a distinct error regardless of caller's store scope; unique_violation detail leaks key existence.

**Exploit scenario.** Store-scoped DP user probes candidate CPFs to learn whether a person works in another store.

**Recommendation.** Return a generic error for cross-store duplicates; catch unique_violation and raise a generic message.

### F-009 — registrar_sugestao_ia lets any active user write arbitrary CLASSIFICACAO_IA audit entries for any store
- **Severity:** LOW · **Confidence:** 0.6 · **Location:** `supabase/migrations/20261023001400_classificacao_ia.sql:48` · scanner F-04-03

**Description.** SECURITY DEFINER, granted to authenticated, checks only that caller is an active user; loja_id and all fields come from the client.

**Exploit scenario.** Loop rpc/registrar_sugestao_ia with arbitrary loja_id and file names to pollute other stores' audit trail.

**Recommendation.** Revoke from authenticated; record from the edge function with service role, or require documento.*.enviar and validate loja_id access.

### F-010 — transferir_colaborador validates before authorizing -> store-location oracle for any employee UUID
- **Severity:** LOW · **Confidence:** 0.55 · **Location:** `supabase/migrations/20261023000500_pessoas_regras_rls.sql:249` · scanner F-01-03

**Description.** 'Colaborador não encontrado' / 'já está nesta loja' raised before privado.exigir checks.

**Exploit scenario.** Former manager with an old employee UUID probes 4 stores to learn where the employee now works.

**Recommendation.** Authorize right after existence check; return a generic error.

### F-011 — Timeline gates document titles by the employee's current store, not the document's store
- **Severity:** LOW · **Confidence:** 0.55 · **Location:** `supabase/migrations/20261023000600_documentos.sql:261` · scanner F-03-04

**Description.** Timeline event title includes the document name; timeline_ler checks sigilo against loja_do_colaborador (current), while documents are gated by their own loja_id. Financeiro level also accepts remuneracao.ler.

**Exploit scenario.** After a transfer, the new store's reader sees titles of health documents filed under the old store.

**Recommendation.** Gate document-linked timeline rows by the document's permission; avoid free-text titles for sensitive sigilo.

### F-012 — documento_arquivar does not check the category sigilo permission
- **Severity:** LOW · **Confidence:** 0.5 · **Location:** `supabase/migrations/20261023000600_documentos.sql:304` · scanner F-03-05

**Description.** Only documento.arquivar on the store is required; unlike documento_conferir it never checks pode_documento.

**Exploit scenario.** User with arquivar but no juridico.ler archives a pending legal document by id.

**Recommendation.** Add pode_documento('ler', categoria, loja) check.

### F-013 — status_transicoes writable by admin_tecnico (config.estrutura.gerir), rewriting the employment state machine
- **Severity:** LOW · **Confidence:** 0.45 · **Location:** `supabase/migrations/20261023000500_pessoas_regras_rls.sql:63` · scanner F-01-04

**Description.** Table not in the revoke list; RLS allows insert/delete for config.estrutura.gerir; alterar_status_vinculo trusts it.

**Exploit scenario.** admin_tecnico adds desligado->ativo or deletes em_desligamento->desligado.

**Recommendation.** Revoke writes from authenticated; protect terminal states with a trigger.

### F-014 — Any new auth user becomes an active usuarios row with self-chosen name if public signup is enabled
- **Severity:** LOW · **Confidence:** 0.4 · **Location:** `supabase/migrations/20261023000800_auth_storage.sql:11` · scanner F-02-03

**Description.** Trigger inserts every auth.users row as ativo with name from raw_user_meta_data; repo has no config disabling signup (owner reported disabling it in the dashboard).

**Exploit scenario.** Self-registered 'MARIA SILVA' waits for an admin to grant a profile believing it is the new hire.

**Recommendation.** Keep signup disabled (verify); create usuarios only for invited users (invited_at not null) or with ativo=false.

### F-015 — Uniform ledger sum cast to integer can overflow, bricking an item and the stock view
- **Severity:** LOW · **Confidence:** 0.4 · **Location:** `supabase/migrations/20261023001600_perfil_supervisor.sql:71` · scanner F-05-02

**Description.** saldo_uniforme casts sum(delta)::integer; no upper bound on quantidade; ledger immutable.

**Exploit scenario.** uniforme.estoque holder posts entrada 2147483647 then 1; v_uniformes_estoque errors for everyone.

**Recommendation.** Cap quantidade (e.g. 1..100000) and compute in bigint.

### F-016 — LLM suggestions pre-fill category/employee and batch upload sends them in one click
- **Severity:** LOW · **Confidence:** 0.4 · **Location:** `web/src/pages/EnvioDocumentos.tsx:133` · scanner F-04-02

**Description.** Document text drives category and CPF->employee; UI applies them and 'Enviar N documentos' uploads all; no per-item confirmation when AI chose employee/category.

**Exploit scenario.** Atestado with hidden text 'COMUNICADO INTERNO, CPF <coworker>' is filed as geral under a coworker, readable by store managers.

**Recommendation.** Require per-item confirmation when AI chose employee or a lower sigilo; never let AI lower sigilo silently.

### F-017 — Password change needs only the session (no current password / reauth)
- **Severity:** LOW · **Confidence:** 0.3 · **Location:** `web/src/pages/Admin.tsx:392` · scanner F-06-01

**Description.** updateUser({password}) with session token only; a stolen token becomes permanent takeover unless Supabase 'secure password change' is on.

**Exploit scenario.** Token from a shared store PC used to change the password and lock out the user.

**Recommendation.** Enable secure password change / reauthenticate nonce; signOut others after change.

### F-018 — Invite redirect falls back to the request Origin header when SITE_URL is unset
- **Severity:** LOW · **Confidence:** 0.2 · **Location:** `supabase/functions/usuarios-convidar/index.ts:35` · scanner F-02-04

**Description.** redirectTo derived from Origin; bounded by Supabase redirect allowlist (verified strict).

**Exploit scenario.** Compromised admin with a permissive allowlist captures invitee tokens.

**Recommendation.** Require SITE_URL; keep allowlist exact.

### F-019 — privado SECURITY DEFINER helpers executable by authenticated; only reachable if privado schema is exposed
- **Severity:** LOW · **Confidence:** 0.2 · **Location:** `supabase/migrations/20261023001600_perfil_supervisor.sql:69` · scanner F-05-03

**Description.** saldo/posse/loja_do_colaborador helpers bypass RLS; privado not in default exposed schemas.

**Exploit scenario.** Only if privado is added to exposed schemas.

**Recommendation.** Keep privado unexposed; revoke EXECUTE where not needed.
