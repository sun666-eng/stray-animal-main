# Production Rollback Runbook

## When to roll back

- Ready probe stuck 503 after deploy
- Error rate spike after JAR swap
- Schema/guard fail-fast abort on start
- Data corruption suspicion (prefer restore over forward-fix)

## Steps

1. Stop **only** the confirmed application PID (match port + JAR path + SHA).
2. Do **not** `Stop-Process -Name java`.
3. Restore previous JAR binary (same path or blue/green swap).
4. Restore previous env config if keys rotated incorrectly (from secret store — not Git).
5. If database migration was applied (should not happen in pure-check prod): restore from last verified backup to a new schema, verify, then cut over.
6. Start previous JAR with `tools/start-prod-example.ps1` after preflight.
7. Confirm `/api/health/live` and `/api/health/ready` are 200.
8. Smoke: admin login, one read-only business page, upload directory write probe via ready.

## Verification

- Same health contract as deploy
- No leftover temp DB users or dump files from the failed deploy
- Port ownership matches the rolled-back PID

## Forbidden

- Pointing prod at `test` database
- Using root DB credentials
- Disabling secure cookies to “fix” login
- Re-enabling auto-migrate/auto-fix in prod to force start
