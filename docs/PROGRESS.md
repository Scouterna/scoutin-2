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

Last updated: 2026-11-08.

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
5. **Look at the lock UI in a browser** (admin session overview, staff check-in,
   kiosk back button, idle timer). Only checked with tsc, tests and Biome so far.

## Later

- Rename the `printer:print` behavior `queue` to `enqueue` (step, startup check, configs, docs).
- Split the oversized `setCompleted` in `stepContext.ts`, as its own commit with tests
  first.
- Step config registry: scan `config/` once at boot and reject an unknown `configFile`
  on link and session creation (`listStepConfigs` re-reads the directory today).
- Make `tokens.ts` the only place that knows the `urn:scoutin:*` claim names.
- Printer profiles on the server, relay self-update from the server, Prometheus
  metrics, Swedish error messages for the printing UI, and the other small items in
  the handoff, section 6.3.
- First real test label on the Pi (owner's step).

## Recently done

- Docker image fixes: copy/build `plugins/printer` (every build since 6 Nov failed on it), and ship the Prisma schema engine (`onlyBuiltDependencies: @prisma/engines`, `openssl` in both stages, build fails if the engine is missing) so `prisma migrate deploy` runs as non-root on a read-only FS; image now serves at `/` (no `/_services/scoutin-2`), making the path configurable is for later. Image build not run yet. Uncommitted.
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
