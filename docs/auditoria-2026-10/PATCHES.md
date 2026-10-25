# Candidate Patches

> **Static review only.** These diffs were authored and reviewed by
> independent agents reading source. They were NOT compiled, run, or
> re-attacked. Read each diff yourself before applying — see
> `docs/patching.md#reviewing-generated-patches` for what to look for.

**Input:** /home/claude/idealize-rh/TRIAGE.json · **Repo:** /home/claude/idealize-rh · 4 findings → 4 diffs

---

## bug_01: [MEDIUM] documentos_editar UPDATE policy lets enviar-holders forge attribution, signature status and dates on approved documents  (f001)

`supabase/migrations/20261023000600_documentos.sql:147` · tampering · owner: component: supabase/migrations/; no CODEOWNERS entry; top committer Diego Bonfim (1/1 recent commits) — owner: Diego Bonfim (Idealize RH)
**Status:** static_review_only · review ACCEPT · style 7/10
**Diff:** `PATCHES/bug_01/patch.diff` (2 hunks, 122 lines)

**Rationale:** Root cause documentos.sql:110-125 travar_documento guarding table-wide UPDATE from documentos_editar (:147). New migration 20261024000200 replaces the trigger function to also lock status_assinatura, enviado_por, criado_por, criado_em, conferido_em (and id) outside via_funcao='documento'; nome/observacoes/dates stay editable.
**Variants checked:** documento_confirmar_upload/conferir/arquivar set via_funcao and keep working; preparar_upload is INSERT (status_assinatura from p_meta left as-is, pre-review); maiusculas backfill touches only nome/observacoes; versoes/acessos already revoked.
**Bypass considered:** Mixed PATCH of free+locked field rejected as a whole; via_funcao cannot be set by clients over PostgREST; new-version path resets approval.

---

## bug_02: [LOW] tarefas UPDATE policy lets assignee move a task to any store and forge origem/concluida_por/chave_dedup  (f007)

`supabase/migrations/20261023000400_auditoria_timeline_tarefas.sql:168` · authorization · owner: component: supabase/migrations/; no CODEOWNERS entry; top committer Diego Bonfim (1/1 recent commits) — owner: Diego Bonfim (Idealize RH)
**Status:** static_review_only · review ACCEPT · style 8/10
**Diff:** `PATCHES/bug_02/patch.diff` (2 hunks, 115 lines)

**Rationale:** Root cause auditoria_timeline_tarefas.sql:168-174 tarefas_editar WITH CHECK branch responsavel_id = auth.uid() with no column/store limits (RLS cannot see OLD). New migration 20261024000300 adds BEFORE UPDATE trigger privado.travar_tarefas: origem/chave_dedup/criado_por/criado_em immutable via API; non-managers (no tarefa.gerir on old AND new store) may only change status/descricao; concluida_por/concluida_em set server-side.
**Variants checked:** tarefas_criar already enforces origem='manual' and gerir; tarefas_ler read-only; timeline/audit_log writes revoked; only other writer is maiusculas (runs earlier alphabetically).
**Bypass considered:** Moving out of a store you manage into one you don't fails (gerir needed on both); reassigning responsavel/colaborador blocked by whole-row diff; client-supplied conclusion fields overwritten; only service role (no auth.uid) bypasses.

---

## bug_03: [LOW] Upload RPCs callable directly: file-less 'confirmed' versions with forged hash/MIME; confirm can roll back or un-archive documents  (f004)

`supabase/migrations/20261023000600_documentos.sql:233` · integrity · owner: component: supabase/migrations/; no CODEOWNERS entry; top committer Diego Bonfim (1/1 recent commits) — owner: Diego Bonfim (Idealize RH)
**Status:** static_review_only · review ACCEPT · style 8/10
**Diff:** `PATCHES/bug_03/patch.diff` (9 hunks, 227 lines)

**Rationale:** Root cause documentos.sql:233-265 documento_confirmar_upload (granted to authenticated) lacks archived, version-ordering and storage-existence checks. New migration 20261024000400 replaces it: row lock (for update of dv, d), reject arquivado, reject versao <= versao_atual, require storage.objects row for the path. Test stub gets storage.objects; existing suite 10 (local and remote) gets teste.simular_arquivo before confirms.
**Variants checked:** preparar_upload already rejects archived and computes version server-side; conferir/arquivar/autorizar_acesso unaffected; only callers are the edge function and test-10 suites.
**Bypass considered:** Archive-then-confirm blocked by status check + row lock; v3-then-v2 rollback blocked; confirm without upload blocked (bucket private, path has server uuid).

---

## bug_00: [MEDIUM] Full CPF recoverable via cpf_mascarado + localizar_colaborador_por_cpf oracle by roles without dados_pessoais.ler  (f002)

`supabase/migrations/20261023001400_classificacao_ia.sql:35` · info-disclosure · owner: component: supabase/migrations/; no CODEOWNERS entry; top committer Diego Bonfim (1/1 recent commits) — owner: Diego Bonfim (Idealize RH)
**Status:** static_review_only · review REJECT · style 5/10 → *fixed after review* (missing MFA-flag line added to test 90; suite passes)
**Diff:** `PATCHES/bug_00/patch.diff` (2 hunks, 82 lines)

**Rationale:** Root cause classificacao_ia.sql:41-42: SECURITY DEFINER RPC matches raw cpf gated only by colaborador.ler. New migration 20261024000100 replaces it requiring colaborador.dados_pessoais.ler (exige_mfa) on the employee's store and audits every call (LOCALIZAR_POR_CPF, never storing the CPF); callers without the permission get 0 rows and the edge function falls back to name matching.
**Variants checked:** cadastrar_colaborador (CPF existence check, gated by colaborador.criar; left as lower-risk follow-up); atualizar_dados_pessoais and colaborador_dados_pessoais already gated; cpf_mascarado only dangerous combined with the oracle; documentos-classificar index.ts:161 only caller.
**Bypass considered:** Store id is the target's own loja_atual_id; aal1 sessions blocked via exige_mfa; no error-based oracle; audit row written in same transaction.
> **Rejected by reviewer:** Migration hunk fixes the root cause (adds colaborador.dados_pessoais.ler + audit to the security-definer RPC; edge function still falls back to name lookup), but the new test 90_correcoes_seguranca_cpf.sql never sets usuarios.mfa_obrigatorio = true, so since 20261023001800 the aal1 director still finds the record and the test fails. Adding `update public.usuarios set mfa_obrigatorio = true;` after the bootstrap makes it mergeable.

---

## Skipped

None.


## Post-review validation

Orchestrator follow-up: the reviewer's only objection (test 90 missing `update public.usuarios set mfa_obrigatorio = true;` after bootstrap) was fixed in the diff; tests 91 also now simulate storage.objects rows required by bug_03. All 4 diffs applied together on a clean copy: full local suite passes (10–93, 115 assertions).
