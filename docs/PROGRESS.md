# Progress

The shared board for everyone working in this repo: the owner and any agents or
sessions. Read it before you start, update it before you finish.

**Rules**
- One line per item. Edit only your own line; add a new line instead of rewriting
  someone else's.
- Put yourself under **Now** when you start something, and move it to **Recently
  done** (with the commit hash if there is one) or back to **Next** when you stop.
- Don't commit or push unless the owner says so. If you work in a separate
  worktree, this file is only shared once it is committed; tell the owner.
- Detail belongs in the linked docs, not here. Keep this file short; trim **Recently
  done** to about ten lines.

Last updated: 2026-11-13.

## Now

Nobody. (Format: `- <who>: <what> (<doc or file>)`)

## Next, in order

1. ~~Core or plugin for `printer:print`~~ **Decided 2026-11-05 (owner): plugin**
   (`plugins/printer`, narrow print API on `plugin-services`). See the handoff, 6.2.
2. ~~Spike~~ **Done 2026-11-05**, result in printer-proxy-spec 9.3: completing from a
   job event works via a core `withStepContext` service. `session.subjects` is now in
   the expression context (`60b96bb`).
3. ~~**Build `printer:print`**~~ **Done** (see Recently done): `behavior: queue | wait` (default `queue`), one job per
   item with an `idempotencyKey`, the "kiosk has no pool" screen, reprints, and the
   startup check that every `printer:print` step names an existing template. It is a
   barrier (`preventGoBack`) and takes the navigation lock in `wait` mode.
4. **DJ26 badge**: look at a real render of the new `dj26` template (studio), confirm type labels and meal lines, check `metadata.group.name` fills from Scoutnet.
5. **VoteIT live grant test** on test meeting 81 (d1.betahaus.net, invite 282 has a `member_id` and only `pa`): one real `add-roles` through the step, then a moderator removes `pv` in VoteIT. Needs the owner's go-ahead.
6. **Look at the lock UI in a browser** (admin session overview, staff check-in,
   kiosk back button, idle timer). Only checked with tsc, tests and Biome so far.

## Later

- VoteIT key in the step config: `with: { baseUrl, apiKeyEnv: VOTEIT_DJ26_API_KEY }` (name the env var, never the key: `with` is stored as `evaluatedInputs` on every step row), replacing the global `VOTEIT_BASE_URL`/`VOTEIT_API_KEY`. Owner: wait.
- CI check that schema and migrations agree: `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code` (needs a shadow DB).
- Rename the `printer:print` behavior `queue` to `enqueue` (step, startup check, configs, docs).
- Split the oversized `setCompleted` in `stepContext.ts`, as its own commit with tests
  first.
- Step config registry: scan `config/` once at boot and reject an unknown `configFile`
  on link and session creation (`listStepConfigs` re-reads the directory today).
- Make `tokens.ts` the only place that knows the `urn:scoutin:*` claim names.
- Printer profiles: apply to all deviating printers in a pool at once, and a deviation marker in the printers table. Relay self-update from the server, Prometheus
  metrics, Swedish error messages for the printing UI, and the other small items in
  the handoff, section 6.3.
- First real test label on the Pi (owner's step).

## Recently done
- `jamboree26:pickupStation`: final DJ26 screen shows the badge pickup station in big text (Dagsdeltagare / Ombud by delegate number / Övriga by last name; gaps → "Leta upp en funktionär"). Replaces the final `base:message` in `stepConfig.dj26.yml` (v0.3.2). Tests, tsc, Biome pass; not checked in a browser.
- "Tillämpa profil" in admin (v0.3.1): dialog picks a profile (default: the pool's), shows profile vs reported settings with differences highlighted, applies to one printer and shows per-setting results (`ApplyProfileDialog.tsx`). Not checked in a browser.
- Printer profiles on the server (v0.3.0): `config/printerProfiles.yml` loaded at startup (missing = none, invalid = none + error log, never stops the server), `GET /api/admin/printing/profiles`, `applyProfile` takes an optional `profile` name, else the pool's; free-form `settings` removed. Prod: copy the file into the `/app/config` mount. Not yet run against a real printer.
- Per-step kiosk layout: optional `layout: { topPadding: none | small | default }` on any step in the step config (unknown keys rejected), sent with each `step:showScreen` (so reconnect replay and back-navigation keep it) and applied to the content panel in `HeroLayout`. DJ26 `confirmDetails` uses `small`. tsc, tests, Biome pass (`7f14ac4`). Fix: `getCurrentStep` dropped `layout`, so it never reached the kiosk.
- Docker image now bakes in the kiosk texts: `EVENT_NAME` / `START_TEXT` build args → `VITE_EVENT_NAME` / `VITE_START_TEXT` (the image build fails if either is missing); values set in `build-image.yml`. Before this the image had neither, so the kiosk threw on load. Checked that a local `vite build` bakes them in; image build not run.
- Kiosk diagnostics menu: 10 quick taps in the top-right corner show kiosk, session (id, screen, actor + idInDataSource), connection and print pool/printer states, with a reload button. Read-only, no auth; backed by `GET /api/kiosk/me` (kiosk key). Tests, tsc, Biome pass; not checked in a browser.
- Fix: `base:script` now declares its `result` output (core keeps only declared outputs, so `printBadges` got `values: null`), and errors from the next step are no longer labeled as script errors (`8b9009f`).
- `voteit:grantVoterRole` (`plugins/voteit`): looks up the delegate's invite by `member_id`, grants `pv` with `add-roles`, checks the response, audits; on failure a kiosk screen with retry or skip (audited, recorded on the participant). Spec rewritten around the finished token API (docs/voteit-integration-spec.md); in the DJ26 step config for delegates. 22 tests, typechecks, Biome pass; read-only calls against test meeting 81 match. Uncommitted.
- Data import now also runs once at boot (in the background, skipped when `DATA_IMPORT_INTERVAL_MS=0`), so a fresh deploy has data right away (`packages/backend/src/index.ts`).
- Missing migration `20261109120000_add_session_kiosk` for `CheckinSession.kioskId` (added to the schema in `50803d9` without a migration; prod `sha-a3ffd13` returned 500 on every session create, P2022). Verified with `prisma dev` (no Docker): all migrations apply and `migrate diff` against the schema shows no difference. Uncommitted.
- Optional `DATABASE_SCHEMA` (default `public`) picks the Postgres schema for both `prisma migrate` (`prisma.config.ts` sets `?schema=` on the URL) and the app (`PrismaPg` `schema` option; the adapter ignores the URL param). Separate variable because the deployed `DATABASE_URL` comes from an infra-owned secret. A `?schema=` in the URL that differs from it fails startup and migrations (`src/config/databaseSchema.ts`). Verified `migrate deploy` + reads/writes into a non-public schema.
- Built-in print font is now Inter 400/700 (latin WOFF, @fontsource/inter, OFL) instead of Roboto: the default for every print and the test label (`printing/assets/fonts`, `render.ts`, docs/printing-templates.md). Printing tests pass.
- Docker image fixes: copy/build `plugins/printer` (every build since 6 Nov failed on it), and ship the Prisma schema engine (`onlyBuiltDependencies: @prisma/engines`, `openssl` in both stages, build fails if the engine is missing) so `prisma migrate deploy` runs as non-root on a read-only FS; image now serves at `/` (no `/_services/scoutin-2`), making the path configurable is for later. Image build not run yet. (`8f50e45`)
- `base:script` step (plugins/base): inline JS from the step config (`variables` + `script`, output `result`), run by `node:vm` with a 1 s timeout behind `runScript` in `runner.ts`. `stepConfig.dj26.yml` uses it to build flat badge values; the `dj26` template is flat again so the admin print form works for walk-ups. Tests (including one that runs the DJ26 badge script from the YAML): `plugins/base/src/script`. Not booted against the real project. Uncommitted.
- Scanner modes for the identify screen (`useBarcodeScanner`): `VITE_SCANNER_MARKERS` (default on, `¤data¤`; set either to `false` to disable) and `VITE_SCANNER_ENTER` (default on, fast type-then-Enter, keys <50 ms apart, min 3 chars); tests in `plugins/base`. Not tried on a real scanner.
- `570deef` `33829e0` Demokratijamboree26 setup (project 73677, individuals only, read-only while testing): `config/dataSourceConfig.dj26.yml` (7 subgroups from question 105667, `badge.*` answers, `group.name`), `config/stepConfig.dj26.yml`, `scoutnet:formAnswers` and `scoutnet:primaryGroup` enrichers. The `dj26` template (git-excluded) now takes `session.subjects` and builds the badge itself (`toBadge`). Not booted against the real project; VoteIT (delegates only) and verification are TODO comments in the step config.
- `CheckinSession.printPoolId`: the printer:print pool comes from the session (kiosk sessions copy the kiosk's pool, admin picks one in the sessions table and the staff check-in chip, which restarts the session; links get one later).
- `f8666c7` `createJobs` now calls `dispatch()` itself (step jobs sat queued next to a ready printer); admin routes no longer call it after `createJobs`.
- `printer:print` plugin (part 2, `plugins/printer`): queue or wait behavior, printing and needs-help screens, startup template check; core gets `stepKey`, `onStartup`, `listStepConfigs`.
- Core support for `printer:print` (part 1; part 2 is the `plugins/printer` step): `CheckinSession.kioskId`, `createJobsForStep`/`listJobsForStep`/`onJobFinished`/`isFinishedJobState` and `withStepContext` on `plugin-services`.
- `a1eb122` frontend for the navigation lock: back button rules, idle timer, "Låst"
  chip, "Avsluta session" button.
- `1581f9a` step barrier (`preventGoBack`) and navigation lock, backend and plugin API.
- `ac20cdb` the `printer:print` option is `behavior: queue | wait`.
- Template renderer, template studio, Print tab and the collapsible admin sidebar are
  on `main`.

## Where the detail is

- Relay, wire protocol and the `printer:print` step: `docs/printer-proxy-spec.md`.
- Barrier and lock: `docs/step-navigation-spec.md`.
- Template authoring and the studio: `docs/printing-templates.md`.
