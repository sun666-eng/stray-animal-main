# SECURITY-AUDIT — Phase 4C

- baseline4b: 893e024b70e9117c89c204ffac67ad3655eb1f4a
- formalRunId: E2E4C_20260801T160823Z_84A8E0
- jarSha256: 919b68e19365e067228797a6f80ad99c8217aa1ef8836751758ce83e2f94f19e
- branch: release/phase-4c-security-privacy-20260801
- head: 893e024b70e9117c89c204ffac67ad3655eb1f4a
- commit/push/main/4D: NO
- note: self-attack + ledger-gate execute after tracked-file freeze; authoritative results in output evidence dir

## Findings

No automated suite failures recorded prior to freeze.

## Coverage

- formalRunId-bound ledgers (no PARTIAL placeholders)
- SSRF matrix via DTO field baseUrl
- Mass-assignment on PUT /api/user/me/profile with DB before/after
- Object ownership matrix (help, adopt, proof, visit, notif, file, favorite, petcare, volunteer)
- CSRF/CORS/session/file/pagination/AI isolation
- Surefire semantic binding (AdminAgentToolsTest + SessionRotationSecurityTest)
- Real self-attack subprocesses (expanded set including worktree/surefire)
- Same-run 4A / 3H / frontend-adversarial / mvn / git-diff
