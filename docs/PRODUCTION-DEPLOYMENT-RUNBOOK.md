# Production Deployment Runbook

## Scope

Deploy the packaged Spring Boot JAR (`target/animal-home-1.0-SNAPSHOT.jar`) with profile `prod`.

This is not a cloud install guide. It assumes a private host, MySQL, and TLS termination (or Spring SSL).

## Preconditions

1. Java 17+
2. MySQL reachable on a **non-localhost** host string with a **non-root** account
3. Database is **not** named `test` or a MySQL system schema
4. Absolute upload directory outside `~/.stray-animal`
5. Environment variables (names only — set values out-of-band):
   - `SPRING_PROFILES_ACTIVE=prod`
   - `JWT_SECRET` (≥32 chars)
   - `AI_CONFIG_ENCRYPTION_KEY` (≥32 UTF-8 bytes, different from JWT)
   - `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD`
   - `FILE_UPLOAD_DIR`
   - `CORS_ALLOWED_ORIGIN_PATTERNS`
   - Optional: `INITIAL_ADMIN_USERNAME`, `INITIAL_ADMIN_PASSWORD` for first bootstrap only
6. `AI_ENABLED=false` unless a controlled AI path is approved
7. External notifications off unless approved

## Build

```text
mvn clean verify
```

Record JAR SHA-256 from the release manifest.

## Preflight

```text
pwsh -File tools/prod-preflight.ps1 -JarPath target/animal-home-1.0-SNAPSHOT.jar -Port <port>
```

Must exit 0. Failures list **config names only**.

## Start

```text
pwsh -File tools/start-prod-example.ps1
```

Or an equivalent service wrapper (winsw / systemd) that:
- sets cwd to the app root
- injects env without writing secrets into unit files committed to Git
- restarts on OOM exit

## Health

- `GET /api/health/live` → HTTP 200 (process up)
- `GET /api/health/ready` → HTTP 200 only when DB + upload dir OK after ApplicationReadyEvent
- Ready failures are HTTP 503 with a generic body (no paths/SQL)

## Post-start checks

1. Live/ready both 200
2. Anonymous management API still 401
3. Admin login over HTTPS
4. Session cookie Secure + HttpOnly + SameSite=Lax
5. Logs contain no secret values

## Rollback

See `docs/PRODUCTION-ROLLBACK-RUNBOOK.md`.
