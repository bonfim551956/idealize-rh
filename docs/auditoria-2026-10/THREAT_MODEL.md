# Threat Model: Idealize RH 360º

## 1. System context

Idealize RH 360º is the HR / payroll-administration ("Departamento Pessoal") system of Óticas Idealize, an optical retail chain with 4 stores (Campinas, Sorocaba, Piracicaba, São Vicente) and roughly 36 employees. It stores employee personal data (CPF, birth date, address), salaries and salary history, employment status, terminations, uniform stock and deliveries, and HR documents. Some of those documents are LGPD-sensitive, such as occupational health exams, medical certificates, payslips, disciplinary and legal records. Users are the directors, central HR, Departamento Pessoal staff, supervisors, store managers, and optionally external accounting or legal staff.

Architecture: a static React/Vite single-page app (TypeScript, about 15 source files) hosted on Vercel at `rh.oticasidealize.online` and deployed automatically from the private GitHub repo `bonfim551956/idealize-rh`. The backend is entirely Supabase:
- Postgres with Row Level Security on every table and about 25 `SECURITY DEFINER` RPCs (in the API-exposed `public` schema) that enforce RBAC through `privado.pode(permission, store)`.
- Supabase Auth with email and password, plus TOTP MFA that is now required **per user**; currently only the owner's account requires it.
- A private Storage bucket for documents.
- Four Deno Edge Functions: upload, signed-URL access, LLM-based document classification through the Anthropic API, and user invitation through the service role.

All writes go through RPCs, and every change is written to an append-only `audit_log`.

## 2. Assets

| asset | description | sensitivity |
|---|---|---|
| Dados pessoais de colaboradores | CPF (full), birth date, address, phone, emergency contacts; CPF masked for low-privilege readers via column grants | high |
| Remuneração | Current salary and salary history per employee | high |
| Documentos sensíveis | Files in private bucket `documentos`: ASO/atestados (health), holerites (financial), disciplinary, legal, contracts | critical |
| Controle de acesso (RBAC) | perfis, perfil_permissoes, usuario_atribuicoes, usuarios.mfa_obrigatorio | critical |
| Trilha de auditoria | audit_log, documento_acessos, eventos_timeline — evidence for LGPD and labor disputes | high |
| Integridade dos registros de RH | vínculos/status, desligamentos, cargos, lotações, estoque e entregas de uniformes | medium |
| Segredos de plataforma | Supabase service-role key, ANTHROPIC_API_KEY (Edge Function secrets) | critical |
| Sessões de usuário | Supabase access/refresh tokens stored in browser localStorage | high |
| Disponibilidade e custo | Edge Function capacity, Anthropic API spend, storage quota | medium |

## 3. Entry points & trust boundaries

| entry_point | description | trust_boundary | reachable_assets |
|---|---|---|---|
| PostgREST API | `/rest/v1` tables, views (security_invoker) and ~25 SECURITY DEFINER RPCs callable with the user JWT and the public publishable key | authenticated user → HR data (RLS/RBAC) | Dados pessoais de colaboradores, Remuneração, Controle de acesso (RBAC), Integridade dos registros de RH, Trilha de auditoria |
| Supabase Auth | login, password recovery, invite links, TOTP enrolment/verification; MFA requirement decided by `usuarios.mfa_obrigatorio` | unauthenticated internet → session | Sessões de usuário, Controle de acesso (RBAC) |
| documentos-upload | multipart upload ≤20 MB, magic-byte type detection, regex PDF active-content filter, then service-role write to private bucket | untrusted file → private storage (service role) | Documentos sensíveis, Disponibilidade e custo |
| documentos-acesso | authorizes via `documento_autorizar_acesso` then issues 60 s signed URL with service role | authenticated user → service-role storage read | Documentos sensíveis, Trilha de auditoria |
| documentos-classificar | sends whole document to Anthropic; forced tool call with closed category enum; matches employee by CPF via RLS-respecting RPC | untrusted document content → LLM → UI suggestion; tenant data → third-party processor | Documentos sensíveis, Dados pessoais de colaboradores, Disponibilidade e custo, Segredos de plataforma |
| usuarios-convidar | invites users via `auth.admin.inviteUserByEmail`; redirect from SITE_URL env or request Origin | user with acesso.gerir → auth admin (service role) | Controle de acesso (RBAC), Sessões de usuário |
| SPA no navegador | React app, CSP `script-src 'self'`, session tokens in localStorage, 30-min client-side idle logout | browser runtime → session tokens | Sessões de usuário, todos os dados acessíveis ao usuário |
| Cadeia de suprimentos | npm deps with `^` ranges (lockfile committed), `npm:@supabase/supabase-js@2` unpinned in Edge Functions, GitHub main → Vercel auto-deploy | third-party code → production | Sessões de usuário, Segredos de plataforma, Documentos sensíveis |
| Contas administrativas | Supabase dashboard/MCP, Vercel, GitHub, Hostinger DNS, Anthropic console | operator identity → full platform control | Segredos de plataforma, Documentos sensíveis, Dados pessoais de colaboradores, Controle de acesso (RBAC), Trilha de auditoria |

## 4. Threats

| id | threat | actor | surface | asset | impact | likelihood | status | controls | evidence |
|---|---|---|---|---|---|---|---|---|---|
| T1 | Account takeover of a privileged HR user (phishing, password reuse, credential stuffing) exposes salaries, CPFs and health documents because MFA is no longer required for non-owner accounts | remote_unauth | Supabase Auth | Documentos sensíveis, Remuneração, Dados pessoais de colaboradores | critical | likely | partially_mitigated | Supabase auth rate limits; 30-min client idle logout; audit of document access; MFA only for owner; leaked-password protection disabled | |
| T2 | Authorization bypass in a SECURITY DEFINER RPC or RLS policy lets an authenticated low-privilege user (store manager, supervisor) read or modify data outside their stores or permissions | remote_auth | PostgREST API | Dados pessoais de colaboradores, Remuneração, Integridade dos registros de RH, Controle de acesso (RBAC) | critical | possible | partially_mitigated | RLS on all tables; `privado.pode`/`exigir` checks in every RPC; column grants on CPF; 8 SQL test suites incl. negative cases | |
| T3 | Compromise of a platform admin account (Supabase, Vercel, GitHub, Hostinger DNS) or leak of the service-role key gives full read/write over all HR data and documents | insider | Contas administrativas | Segredos de plataforma, Documentos sensíveis, Dados pessoais de colaboradores, Trilha de auditoria | critical | possible | unmitigated | private repo; secrets only in Supabase env; no evidence of org-level MFA enforcement on platform accounts | |
| T4 | Privilege escalation through the access-management plane (grant/revoke, MFA requirement, invites) by a user who holds `acesso.gerir` or by confusing RBAC scope (global vs per-store assignments) | remote_auth | PostgREST API, usuarios-convidar | Controle de acesso (RBAC) | critical | rare | partially_mitigated | no self-grant; no self MFA change; acesso.gerir only for diretoria/rh_central; all changes audited | |
| T5 | Session token theft from the browser (XSS, malicious extension, shared store PC) yields a long-lived refresh token usable from anywhere | remote_unauth | SPA no navegador | Sessões de usuário, Documentos sensíveis | high | possible | partially_mitigated | strict CSP (script-src 'self', frame-ancestors none); React escaping; client-side 30-min idle sign-out (server refresh token not time-boxed) | |
| T6 | Sensitive document content or personal data disclosed to a third party via the LLM classification path (data sent to Anthropic; prompt-injected document steering suggestions to the wrong employee or category) | remote_auth | documentos-classificar | Documentos sensíveis, Dados pessoais de colaboradores | high | possible | partially_mitigated | output forced to closed enum; server re-validation; employee matched by CPF in own DB under RLS; human confirms; no diagnosis fields | |
| T7 | Malicious file upload (active PDF content evading regex filter, polyglot image) delivered to HR staff who open it via signed URL | remote_auth | documentos-upload, documentos-acesso | Sessões de usuário, Documentos sensíveis | high | possible | partially_mitigated | magic-byte allowlist (PDF/JPEG/PNG/WEBP); regex reject of /JavaScript /Launch /OpenAction /EmbeddedFile; private bucket; 60 s signed URLs served from supabase.co origin | |
| T8 | Tampering with or repudiation of HR records and audit evidence (editing document metadata, uploader attribution, conference timestamps) by an authorized user who wants to hide an action | insider | PostgREST API | Trilha de auditoria, Integridade dos registros de RH | high | possible | partially_mitigated | audit_log append-only via trigger; trigger locks status/version/store/category on documentos; uniform ledger immutable with reversal entries | |
| T9 | Supply-chain compromise of an npm package or the unpinned Deno `npm:` import ships malicious code to production via auto-deploy | supply_chain | Cadeia de suprimentos | Sessões de usuário, Segredos de plataforma, Documentos sensíveis | high | rare | partially_mitigated | package-lock committed for SPA; Edge Functions import `npm:@supabase/supabase-js@2` (major only) | |
| T10 | Cost / availability abuse by repeatedly calling the LLM classifier or upload endpoint (large files, loops) exhausting Anthropic budget or function quota | remote_auth | documentos-classificar, documentos-upload | Disponibilidade e custo | medium | possible | unmitigated | 20 MB cap; permission required (documento.*.enviar); no per-user rate limit | |
| T11 | Information disclosure through verbose server error messages and wide-open CORS reflection on Edge Functions | remote_unauth | documentos-upload, documentos-acesso, usuarios-convidar, documentos-classificar | Dados pessoais de colaboradores | low | possible | partially_mitigated | bearer-token auth (no cookies) limits CORS impact; ORIGENS_PERMITIDAS optional allowlist; DB messages returned raw | |
| T12 | Invite / recovery link redirection to an attacker-controlled host to capture tokens | remote_unauth | usuarios-convidar, Supabase Auth | Sessões de usuário | medium | rare | mitigated | Supabase redirect allowlist (verified: only rh.oticasidealize.online/** and idealize-rh.vercel.app/**); Site URL set | |
| T13 | DNS / domain hijack of oticasidealize.online redirects users to a credential-harvesting clone | remote_unauth | Contas administrativas | Sessões de usuário | high | rare | partially_mitigated | HSTS includeSubDomains (2 y) on Vercel; DNS at Hostinger, account security unknown | |
| T14 | Data retention beyond legal need / failure to honour LGPD subject rights because documents and records are never purged | insider | PostgREST API | Documentos sensíveis, Dados pessoais de colaboradores | medium | likely | unmitigated | retention parameters per category exist but marked unvalidated; no purge job | |

## 5. Deprioritized

| threat | reason |
|---|---|
| SQL injection via PostgREST / RPC parameters | All DB access is parameterized PostgREST or plpgsql with typed params; only `format(%s)` use is with a hard-coded function list in a migration |
| Memory-corruption RCE in the SPA or Edge Functions | Managed runtimes (V8/Deno, browser); no native parsing code in tree |
| Direct public access to the Storage bucket | Bucket is private with no user-facing policies; all access via service role after DB authorization |
| Anonymous (anon role) data access | Functions revoked from anon; RLS policies target `authenticated`; advisor shows no RLS gaps |
| Network-level attacks on Supabase/Vercel infrastructure | Platform-provider responsibility; out of scope for this codebase |

## 6. Open questions

- Do all platform accounts (Supabase org "SDR COM IA", Vercel, GitHub, Hostinger, Anthropic) have MFA enabled and who else has access to them?
- Are store PCs shared between employees (affects T1/T5 — session reuse on shared machines)?
- Is the decision to drop MFA for HR/DP users time-boxed? When will it be re-enabled for Departamento Pessoal and supervisors?
- Has the Data Processing Agreement / LGPD basis for sending HR documents (including health documents) to Anthropic been reviewed (T6)?
- What are the legally required retention periods per document category (T14)?
- Is there a Supabase plan-level setting for session time-box / inactivity timeout and leaked-password protection that can be turned on?
- Is `ORIGENS_PERMITIDAS` set in Edge Function secrets in production?

## 7. Provenance

- mode: bootstrap
- date: 2026-10-24
- target: /home/claude/idealize-rh @ 068f459
- inputs: git-log mined (10 commits, no security fixes); live config observed via Supabase advisors and redirect probing
- owner: unset

## 8. Recommended mitigations

| mitigation | threat_ids | closes_class | effort |
|---|---|---|---|
| Re-require MFA for every user holding a sensitive permission (remuneracao, saude, financeiro, acesso.gerir) and enable Supabase leaked-password protection | T1,T5 | partial | S |
| Enforce MFA and least-privilege membership on all platform accounts (Supabase, Vercel, GitHub, Hostinger, Anthropic); rotate service-role key on staff changes | T3,T13 | partial | S |
| Keep the authorization test suite as a CI gate and add a negative test for every new RPC/policy (role × store matrix) | T2,T4,T8 | partial | M |
| Server-side session time-box / inactivity timeout in Supabase Auth plus "sign out everywhere" on role revocation | T5,T1 | partial | S |
| Per-user rate limit and daily budget cap on documentos-classificar and documentos-upload | T10 | yes | S |
| Replace regex PDF filter with a sanitizing re-render (rasterize/flatten) or serve PDFs only with `Content-Disposition: attachment` | T7 | partial | M |
| Lock all integrity-relevant metadata columns (enviado_por, conferido_em) behind the function-only trigger | T8 | partial | S |
| Pin Edge Function imports to exact versions and enable Dependabot on the repo | T9 | partial | S |
| Return generic error messages from Edge Functions and set ORIGENS_PERMITIDAS to the two production origins | T11 | yes | S |
| Document LGPD basis/DPA for the LLM processor; allow disabling AI reading for health category | T6 | partial | S |
| Validate retention table with counsel and add scheduled purge/anonymization job | T14 | yes | M |
