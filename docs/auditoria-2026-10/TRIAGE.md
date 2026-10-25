# Triage Report

19 in -> 0 duplicates, 15 false positives, 4 confirmed (0 high / 2 med / 2 low), 0 need manual test

Context: auto; environment = Unknown. Treat any externally-reachable entry point as untrusted; flag trust-boundary assumptions explicitly in rationale. (Per THREAT_MODEL.md: internet-facing SPA + Supabase PostgREST/Edge Functions; any authenticated employee account is untrusted relative to stores/permissions it was not granted.); scoring = derived HIGH/MEDIUM/LOW; 3-vote verification.

## Act on these

### [MEDIUM] Full CPF recoverable via cpf_mascarado + localizar_colaborador_por_cpf oracle by roles without dados_pessoais.ler  (f002)
`supabase/migrations/20261023001400_classificacao_ia.sql:35` | info-disclosure | claimed HIGH (alignment -2) | confidence 8.0/10
**Owner:** component: supabase/migrations/; no CODEOWNERS entry; top committer Diego Bonfim (1/1 recent commits) — owner: Diego Bonfim (Idealize RH)
**Verdict:** exploitable, votes {'true_positive': 3, 'false_positive': 0, 'cannot_verify': 0}
**Preconditions (4):**
- Authenticated employee session (function revoked from anon)
- Holds colaborador.ler for the target's current store (gerente_loja or supervisor)
- Lacks colaborador.dados_pessoais.ler but can read cpf_mascarado (middle 6 digits -> 1,000 candidates)
- No rate limit / MFA step-up / per-call audit on rpc/localizar_colaborador_por_cpf (~1,000 calls per target)
**Threat-model match:** none
**Why:** localizar_colaborador_por_cpf (20261023001400_classificacao_ia.sql:35-45) is SECURITY DEFINER, granted to authenticated, matches raw c.cpf and requires only colaborador.ler (no MFA, 20261023000700_dashboard_seeds.sql:54), so it confirms the correct guess without an audit record. gerente_loja (dashboard_seeds.sql:117) and supervisor (20261023001600_perfil_supervisor.sql:15) hold colaborador.ler but not colaborador.dados_pessoais.ler, and can read cpf_mascarado (20261023000500_pessoas_regras_rls.sql:11-12,19), which exposes digits 4-9 so only 1,000 valid candidates remain. They bypass the MFA-gated, audited colaborador_dados_pessoais path (pessoas_regras_rls.sql:176-186); no later migration, revoke or rate limit closes the gap.

The SECURITY DEFINER RPC matches on raw cpf and checks only colaborador.ler, so a store manager can brute-force the 3 hidden leading digits of a coworker's CPF and recover the full number, bypassing the MFA-gated, audited colaborador_dados_pessoais path. Requires an authenticated role and only reaches employees of stores the attacker already manages, ~1,000 calls each: MEDIUM rather than HIGH, but it is LGPD-regulated personal data and should be prioritized.
**Reachability evidence:** supabase/functions/documentos-classificar/index.ts:161

### [MEDIUM] documentos_editar UPDATE policy lets enviar-holders forge attribution, signature status and dates on approved documents  (f001)
`supabase/migrations/20261023000600_documentos.sql:147` | tampering | claimed MEDIUM (alignment +0) | confidence 6.3/10
**Owner:** component: supabase/migrations/; no CODEOWNERS entry; top committer Diego Bonfim (1/1 recent commits) — owner: Diego Bonfim (Idealize RH)
**Verdict:** exploitable, votes {'true_positive': 3, 'false_positive': 0, 'cannot_verify': 0}
**Preconditions (3):**
- Valid active account calling PostgREST directly (PATCH /rest/v1/documentos)
- Holds documento.<nivel>.enviar for the document's category and store (e.g. gerente_loja/supervisor via documento.geral.enviar)
- Target document is in a category/store the attacker already has upload rights for (loja/categoria locked by trigger)
**Threat-model match:** none
**Why:** The documentos_editar policy (20261023000600_documentos.sql:147-149) gives table-wide UPDATE to anyone with enviar permission for that category and store, and no migration revokes or narrows UPDATE on public.documentos (line 157 revokes only insert and delete). travar_documento (lines 113-122) locks only status, conferido_por, versao_atual, loja_id, colaborador_id and categoria_id, so a direct PostgREST PATCH can rewrite enviado_por, criado_por, conferido_em, status_assinatura and vencimento on an approved document without resetting approval. The comment at line 146 limits intended edits to name, dates and notes, so attribution and signature fields are not covered by intended design. The audit trigger (line 95) only records the change.

A store-scoped employee with upload rights but no documento.conferir can rewrite enviado_por, criado_por, conferido_em, status_assinatura and vencimento on an already-approved document without resetting approval, faking authorship, signature state, or hiding expiries from dashboard counters. Needs login plus a per-store permission and is confined to the attacker's own store/category; the auditar trigger logs every change. MEDIUM, matching the scanner.
**Reachability evidence:** supabase/migrations/20261023000600_documentos.sql:147

### [LOW] tarefas UPDATE policy lets assignee move a task to any store and forge origem/concluida_por/chave_dedup  (f007)
`supabase/migrations/20261023000400_auditoria_timeline_tarefas.sql:168` | authorization | claimed LOW (alignment +0) | confidence 7.3/10
**Owner:** component: supabase/migrations/; no CODEOWNERS entry; top committer Diego Bonfim (1/1 recent commits) — owner: Diego Bonfim (Idealize RH)
**Verdict:** exploitable, votes {'true_positive': 3, 'false_positive': 0, 'cannot_verify': 0}
**Preconditions (5):**
- Authenticated account
- A manager already assigned the attacker as responsavel_id on an existing task (insert needs tarefa.gerir)
- Direct PATCH /rest/v1/tarefas (no tasks UI yet)
- Knows the target store's loja_id UUID
- chave_dedup squatting only matters once system task generation exists (not yet)
**Threat-model match:** none
**Why:** The WITH CHECK of tarefas_editar (20261023000400_auditoria_timeline_tarefas.sql:172-174) accepts any new row where responsavel_id = auth.uid(), without checking tarefa.gerir on the new loja_id and without the origem='manual' rule the insert policy enforces (line 165). No column revokes for authenticated, no replacement policy and no blocking trigger exist (only timestamp, uppercase and audit). An assignee can PATCH a task into another store with origem='sistema' and a forged title, visible via tarefas_ler (line 162), and can squat a unique chave_dedup (line 132).

The WITH CHECK on tarefas_editar lets an assignee move their task into any store with origem='sistema' and any title; nothing blocks it and auditar only records it. Impact is limited to integrity of one task record (fake 'system' task in another store's queue, or future dedup-key squatting); no data read or privilege gained. LOW, matching the scanner.
**Reachability evidence:** supabase/migrations/20261023000400_auditoria_timeline_tarefas.sql:172

### [LOW] Upload RPCs callable directly: file-less 'confirmed' versions with forged hash/MIME; confirm can roll back or un-archive documents  (f004)
`supabase/migrations/20261023000600_documentos.sql:233` | integrity | claimed MEDIUM (alignment -2) | confidence 6.7/10
**Owner:** component: supabase/migrations/; no CODEOWNERS entry; top committer Diego Bonfim (1/1 recent commits) — owner: Diego Bonfim (Idealize RH)
**Verdict:** exploitable, votes {'true_positive': 3, 'false_positive': 0, 'cannot_verify': 0}
**Preconditions (4):**
- Authenticated employee calling rpc/documento_confirmar_upload directly or via the edge function
- Passes pode_documento('enviar', categoria, loja) at both prepare and confirm
- Attacker started the still-unconfirmed version themselves (enviado_por = auth.uid())
- For the un-archive impact: a separate privileged user archived the document between prepare and confirm
**Threat-model match:** none
**Why:** documento_confirmar_upload (supabase/migrations/20261023000600_documentos.sql:233-257) is granted to authenticated (lines 343-352) and callable directly via PostgREST. It never checks that the storage object exists, the document status, or that v.versao > versao_atual, and it sets status='recebido' clearing the review fields. The archived check exists only at prepare time (line 216), so an uploader without documento.arquivar (required at line 304) can prepare a version, wait for archiving, then confirm it to un-archive the document with no file behind it. The promised 24 h cleanup of unconfirmed versions (line 165) does not exist.

The harmful case (un-archiving without documento.arquivar) needs an authenticated user with enviar on the category/store, a self-created pending version, and an intervening archive by someone else: 3+ preconditions, LOW. The shorter path (a confirmed version with no file and client-supplied hash/MIME) gains little over uploading junk. Impact is confined to documents the attacker can already write; scanner MEDIUM is one level inflated.
**Reachability evidence:** supabase/functions/documentos-upload/index.ts:69

## Dropped

| id | title | file:line | why dropped |
|---|---|---|---|
| f003 | PDF active-content regex filter bypassable (#xx name escapes, compressed object streams, unlisted /AA /URI /SubmitForm) | supabase/functions/_shared/comum.ts:55 | not_actionable; rule 13 |
| f005 | Per-user MFA flag makes every exige_mfa permission (incl. acesso.gerir) password-only for all non-owner accounts | supabase/migrations/20261023001800_mfa_por_usuario.sql:19 | intentional_behavior; rule 3 |
| f006 | Access-management has no grant ceiling and no protection of the owner (revoke / disable owner's MFA) | supabase/migrations/20261023001700_supervisor_todas_lojas.sql:35 | intentional_behavior; rule 3 |
| f008 | cadastrar_colaborador / atualizar_dados_pessoais reveal CPF existence across stores | supabase/migrations/20261023000500_pessoas_regras_rls.sql:118 | intentional_behavior; rule 3 |
| f009 | registrar_sugestao_ia lets any active user write arbitrary CLASSIFICACAO_IA audit entries for any store | supabase/migrations/20261023001400_classificacao_ia.sql:48 | intentional_behavior, not_actionable; rule 12 |
| f010 | transferir_colaborador validates before authorizing -> store-location oracle for any employee UUID | supabase/migrations/20261023000500_pessoas_regras_rls.sql:249 | implausible_trigger; rule 12 |
| f011 | Timeline gates document titles by the employee's current store, not the document's store | supabase/migrations/20261023000600_documentos.sql:261 | intentional_behavior; rule 3 |
| f012 | documento_arquivar does not check the category sigilo permission | supabase/migrations/20261023000600_documentos.sql:304 | implausible_trigger; rule 15 |
| f013 | status_transicoes writable by admin_tecnico (config.estrutura.gerir), rewriting the employment state machine | supabase/migrations/20261023000500_pessoas_regras_rls.sql:63 | intentional_behavior; rule 3 |
| f014 | Any new auth user becomes an active usuarios row with self-chosen name if public signup is enabled | supabase/migrations/20261023000800_auth_storage.sql:11 | intentional_behavior, implausible_trigger; rule 13 |
| f015 | Uniform ledger sum cast to integer can overflow, bricking an item and the stock view | supabase/migrations/20261023001600_perfil_supervisor.sql:71 | implausible_trigger; rule 12 |
| f016 | LLM suggestions pre-fill category/employee and batch upload sends them in one click | web/src/pages/EnvioDocumentos.tsx:133 | intentional_behavior; rule 6 |
| f017 | Password change needs only the session (no current password / reauth) | web/src/pages/Admin.tsx:392 | not_actionable; rule 13 |
| f018 | Invite redirect falls back to the request Origin header when SITE_URL is unset | supabase/functions/usuarios-convidar/index.ts:35 | implausible_trigger, already_handled; rule 13 |
| f019 | privado SECURITY DEFINER helpers executable by authenticated; only reachable if privado schema is exposed | supabase/migrations/20261023001600_perfil_supervisor.sql:69 | implausible_trigger; rule 13 |
