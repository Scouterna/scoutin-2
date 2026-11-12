# Public API and API keys

Status: design, not built. Written 2026-11-11.

Other systems call this API with an API key. The first caller is an app that asks
whether a participant, identified by Scoutnet member number, is checked in, plus
event-specific details (for DJ26: participant type and meal choices).

## 1. Goals and non-goals

Goals:
- Admins create, list and revoke API keys in the admin panel.
- Each key has a set of permissions; every public route requires one.
- `GET` one participant: check-in status, participant type, and the fields the data
  source config exposes.
- Every authenticated call is in the audit log.

Not in scope now: rate limiting, key expiry dates, per-key IP allowlists, write
endpoints, webhooks, OAuth, scoping a key to one data source. Each can be added
later without changing the key format or the table.

## 2. Data model

```prisma
// A key another system uses to call /api/public. Only the hash is stored.
model ApiKey {
  id          String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name        String
  // First characters of the key ("sci_ab12cd34"), shown in the admin list so
  // staff can tell keys apart. Not secret.
  prefix      String
  keyHash     String    @unique
  // Permission strings from API_PERMISSIONS (see 3).
  permissions String[]
  // Admin username who created it.
  createdBy   String?
  lastUsedAt  DateTime?
  revokedAt   DateTime?
  createdAt   DateTime  @default(now())
}
```

Revoking sets `revokedAt` instead of deleting, so the audit trail and the admin list
keep the key's name. A revoked key never authenticates again.

## 3. Keys and permissions

**Existing code:** there is no API key system or public API yet. Kiosks and print
relays have their own device keys (`Kiosk.keyHash`, `PrintRelay.keyHash`); those
stay separate, since they belong to pairing flows and device state and have no
permissions. Their helpers are reused instead: the two identical SHA-256 helpers
(`kiosk.service.ts` `hashKey`, `enrollment.service.ts` `hashSecret`) and the three
copies of bearer parsing (`printing.routes.ts`, `relay.socket.ts`,
`session.routes.ts`) move into one module, `core/auth/secrets.ts`
(`hashSecret`, `readBearerToken`), and the existing callers use it.

**Format:** `sci_` + 32 random bytes as base64url (43 chars). The prefix makes a
leaked key easy to recognize in logs and secret scanners. Stored as SHA-256 hex, the
same as `Kiosk.keyHash` and `PrintRelay.keyHash`: the key is high-entropy, so a slow
hash adds nothing. Shown once, at creation.

**Sent as:** `Authorization: Bearer sci_...`. No query-string keys (they end up in
access logs).

**Permissions** are a fixed list in code, the only source of truth:

```ts
export const API_PERMISSIONS = ["participants:read"] as const;
export type ApiPermission = (typeof API_PERMISSIONS)[number];
```

Create and update validate against it (ArkType). A permission string in the database
that is no longer in the list grants nothing. Each permission has a Swedish label for
the admin UI, next to the list.

## 4. Middleware

`domains/apiKeys/apiKeys.service.ts`:

- `authenticateApiKey(key)`: hash, find by `keyHash` with `revokedAt: null`, return
  `{ id, name, permissions }` or null. Updates `lastUsedAt` on every request (the
  audit row is written per request anyway).
- `requireApiKey`: reads the bearer token, 401 `{ error: "unauthorized" }` when
  missing or invalid (same body for both, a warning log line, no audit row: there is
  no key to attribute it to). Sets `c.set("apiKey", ...)` and a child
  logger with `apiKeyId`.
- `requirePermission(p: ApiPermission)`: 403 `{ error: "forbidden" }` when the key
  lacks `p`, audited (see 5.2).

Every route under `/api/public` goes through `requireApiKey`; every handler also
names its permission. No route is reachable with only "a valid key".

Admin cookies do not work on `/api/public`, and API keys do not work on
`/api/admin`. The two auth paths stay separate.

## 5. Routes

Mounted at `/api/public/v1` in `app.ts`, outside `/api/admin`. Server-to-server, so
no CORS headers (the dev CORS middleware on `/api/*` stays dev-only).

Participants are identified the way the rest of the system does it: data source
name + `idInDataSource`, the DB `id`, or a lookup value. Only the first is built now,
because the first caller has a Scoutnet member number (the `idInDataSource` of
Scoutnet data sources).

### 5.1 `GET /api/public/v1/data-sources/:dataSource/participants/:idInDataSource`

Permission: `participants:read`.

Finds the participant by the unique `(dataSource, idInDataSource)` with
`deletedAt: null`. Rows with import errors are still answered: their check-in
timestamp is valid even if their imported data isn't.

200 (DJ26):

```json
{
  "id": "6f1c...",
  "dataSource": "participants",
  "idInDataSource": "3012345",
  "checkinStatus": "confirmed",
  "confirmedCheckedInAt": "2026-11-11T09:12:00.000Z",
  "preliminaryCheckedInAt": "2026-11-02T18:40:00.000Z",
  "firstName": "Alva",
  "lastName": "Berg",
  "subGroup": "delegate",
  "fields": {
    "lunchSaturday": "Vegetarisk",
    "lunchSunday": "Vegetarisk",
    "dinnerSaturday": "Kött",
    "dinnerSeating": "Sittning 1 ca 18.00"
  }
}
```

- `checkinStatus`: `"confirmed" | "preliminaryOnly" | "missing"`, the names the
  roster report already uses (`StatusBucket` in `reports.service.ts`):
  `confirmed` when `confirmedCheckedInAt` is set (the value the Scoutnet write-back
  pushes), else `preliminaryOnly` when `preliminaryCheckedInAt` is set, else
  `missing`. The report's other two buckets don't apply here: a cancelled
  participant is a 404, and import errors don't change check-in status. Those three
  branches move out of `classifyParticipant` into a shared `checkinStatus(p)` that
  both the report and this route call, so the rule lives in one place.
- `confirmedCheckedInAt`, `preliminaryCheckedInAt`: the timestamps, or null.
- `firstName`, `lastName`: as imported.
- `subGroup`: the subgroup key from the data source config (`delegate`,
  `participant`, `staff`, ...), or null. The key, not the display name, so callers can
  match on it.
- `fields`: what the data source config's `publicApi.fields` says, evaluated per
  participant with the existing expression engine (the same `${{ }}` syntax as
  `subGroupConditions`), with `participant` (including `metadata`) in the context. A
  data source without `publicApi` returns `fields: {}`. An expression that fails to
  evaluate gives null for that field, logged as a warning.

```yaml
# config/dataSourceConfig.dj26.yml
dataSources:
  participants:
    publicApi:
      fields:
        lunchSaturday: ${{ participant.metadata.badge.lunchSaturday }}
        lunchSunday: ${{ participant.metadata.badge.lunchSunday }}
        dinnerSaturday: ${{ participant.metadata.badge.dinnerSaturday }}
        dinnerSeating: ${{ participant.metadata.badge.dinnerSeating }}
```

The exposed fields live in the event's config, next to where they are imported,
because they are event-specific. Nothing from `metadata` is returned unless the config
names it. Every key with `participants:read` sees the same fields; per-key field lists
can come later if two integrations need different data.

404 `{ error: "not_found" }` for an unknown data source or participant, so the caller
can tell "not registered" from "not checked in yet". This reveals who is registered
only to a key holder, who learns that (and more) from any 200 anyway; without a key
every request is a 401 before any lookup. The risk to manage is a leaked key: one key
per integration, revoke on suspicion, watch the audit log, and add a per-key rate
limit if a key ever lives outside a trusted server.

Later, with the same response (not built now):
- `GET /api/public/v1/participants/:id`.
- `POST /api/public/v1/participants/lookup` `{ value }`: a POST because lookup values
  include personal identity numbers, which must stay out of URLs and access logs.
  Returns a list (a value can match several participants), normalized and hashed with
  `hashIdentifier`.

### 5.2 Audit

One `AuditLog` row per request with a valid key, via `recordAudit`. It records only
that a key read a participant:

- `actor`: `api-key:<id>`
- `action`: `public-api.participants.read`
- `details`: `{ participantId }`, null when not found or forbidden.

Nothing else: no identifiers, no response data. A lookup-value route would log only
the `participantId`s it returned. `recordAudit` swallows write errors, so a failed
audit write does not fail the request (the same rule as every other audit in the app).

### 5.3 OpenAPI

The spec is generated from the routes with
[`hono-openapi`](https://github.com/rhinobase/hono-openapi), which reads ArkType
schemas through Standard Schema and keeps `AppType`/`hc()` typing intact. Check its
current API against our Hono and ArkType versions before building.

- Each public route has `describeRoute({...})` with its 200, 400, 401, 403 and 404
  responses, and validates params with the library's validator instead of
  `arktypeValidator`.
- The 200 body is one ArkType type; the handler returns `typeof X.infer`, so the
  documented shape and what `c.json` sends can't drift without a type error.
- `fields` and `dataSource` come from the loaded data source config at boot: an enum of
  configured data source names, and the keys of each `publicApi.fields` (values
  nullable, type unknown). If the library can't take schemas built at runtime, fall
  back to `Record<string, unknown>` and a string, and note it here.
- The bearer scheme is declared as a security scheme on every route.
- Served at `GET /api/public/v1/openapi.json`, without auth: it holds data source and
  field names, never data. No docs UI for now.

## 6. Admin UI and routes

Admin role only (`.use("/api-keys/*", requireAdmin)` in `admin.ts`).

- `GET /api/admin/api-keys`: id, name, prefix, permissions, createdBy, createdAt,
  lastUsedAt, revokedAt. Never the hash.
- `POST /api/admin/api-keys` `{ name, permissions }`: returns the row plus `key`,
  once.
- `PATCH /api/admin/api-keys/:id` `{ name?, permissions? }`: changes take effect on
  the next request.
- `POST /api/admin/api-keys/:id/revoke`.
- `GET /api/admin/api-keys/permissions`: the list with labels, for the form.

Audit log (`AuditLog`) on create, permission change and revoke, with the key id,
name and permissions. Never the key.

Frontend: an "API-nycklar" page in the admin sidebar (MUI, like the other admin
pages): a table, a create dialog with name and permission checkboxes, and a dialog
that shows the new key once with a copy button and "Du kommer inte att se nyckeln
igen". Revoke asks for confirmation.

## 7. Tests

- Service: valid key, unknown key, revoked key, `lastUsedAt` throttle.
- Middleware: missing header, wrong scheme, valid key without the permission (403),
  stale permission string grants nothing.
- Route: `fields` from `publicApi`, `fields: {}` without it, a failing expression
  gives null, `subGroup` key, each `checkinStatus`, unknown participant or data source (404),
  deleted participant (404), participant with import errors still answered.
- OpenAPI: `openapi.json` lists the route, the bearer scheme, and the DJ26 `fields`
  keys when the DJ26 config is loaded.
- Audit: a row for 200, 403 and 404 with `participantId`; none for 401.
- Existing kiosk and relay auth still pass after the move to `core/auth/secrets.ts`.

## 8. Decisions

- Unknown or cancelled participant: 404 (2026-11-11), reasoning in 5.1.
- DJ26 exposes all four meal fields (2026-11-11).
- No open questions.
