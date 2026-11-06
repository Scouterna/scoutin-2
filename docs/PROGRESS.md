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

Last updated: 2026-11-05.

## Now

Nobody. (Format: `- <who>: <what> (<doc or file>)`)

## Next, in order

1. ~~Core or plugin for `printer:print`~~ **Decided 2026-11-05 (owner): plugin**
   (`plugins/printer`, narrow print API on `plugin-services`). See the handoff, 6.2.
2. ~~Spike~~ **Done 2026-11-05**, result in printer-proxy-spec 9.3: completing from a
   job event works via a core `withStepContext` service. `session.subjects` is now in
   the expression context (uncommitted, tsc and Biome clean).
3. **Build `printer:print`**: `behavior: queue | wait` (default `queue`), one job per
   item with an `idempotencyKey`, the "kiosk has no pool" screen, reprints, and the
   startup check that every `printer:print` step names an existing template. It is a
   barrier (`preventGoBack`) and takes the navigation lock in `wait` mode.
4. **Look at the lock UI in a browser** (admin session overview, staff check-in,
   kiosk back button, idle timer). Only checked with tsc, tests and Biome so far.

## Later

- Split the oversized `setCompleted` in `stepContext.ts`, as its own commit with tests
  first.
- Make `tokens.ts` the only place that knows the `urn:scoutin:*` claim names.
- Printer profiles on the server, relay self-update from the server, Prometheus
  metrics, Swedish error messages for the printing UI, and the other small items in
  the handoff, section 6.3.
- First real test label on the Pi (owner's step).

## Recently done

- `a1eb122` frontend for the navigation lock: back button rules, idle timer, "Låst"
  chip, "Avsluta session" button.
- `1581f9a` step barrier (`preventGoBack`) and navigation lock, backend and plugin API.
- `ac20cdb` the `printer:print` option is `behavior: queue | wait`.
- Template renderer, template studio, Print tab and the collapsible admin sidebar are
  on `main`.

## Where the detail is

- Printing overall: `docs/printing-handoff.md` (rules, state, decisions, how to run
  and verify).
- Relay, wire protocol and the `printer:print` step: `docs/printer-proxy-spec.md`.
- Barrier and lock: `docs/step-navigation-spec.md`.
- Template authoring and the studio: `docs/printing-templates.md`.
