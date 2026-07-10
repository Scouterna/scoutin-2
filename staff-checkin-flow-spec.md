# Staff (funktionär) check-in flow — implementation spec

Target: the on-site check-in flow for the **`staff`** data source at Jamboree26.
This document is a design spec, not a config file. It describes the intended flow,
which pieces already exist, which must be built, and the decisions already made.
Produce the `stepConfig.yml` changes, the new plugin(s), and the enrichers described
below.

---

## 1. Context you need before implementing

This is a plugin/config-driven check-in app for a scouting event.

- **Flows.** There are two: an on-site kiosk flow (`packages/backend/config/stepConfig.yml`)
  and a mobile pre-check-in flow (`stepConfig.pre-checkin.yml`). **The mobile flow is
  `groups`-only and is out of scope here.** Everything below concerns the on-site flow.
- **Where staff check-in runs.** The physical kiosk *and* the admin view at
  `/admin/checkin` (`components/admin/StaffCheckin.tsx`), which runs the same
  `stepConfig.yml` on-site flow unchanged. Anything added to the on-site flow is
  automatically exercised by both.
- **No preliminary phase for staff.** `staff` is self-check-in and only ever reaches
  `base:markConfirmedCheckedIn`. The preliminary/`markPreliminaryCheckedIn` and
  "pre-selected by default" behaviours are mobile/`groups` concepts and do not apply.

### Architecture primitives

- **Steps** are registered by plugins (`registerStep`) and sequenced in `stepConfig.yml`,
  branched by data source. Relevant existing step types: `base:identify`,
  `base:setActorAsSubject`, `base:confirmReCheckin`, `base:deduplicateSession`,
  `base:selectSubjects`, `base:markConfirmedCheckedIn`, `base:message`.
  `scoutnet:checkLeaderRequirements` also exists but is a **fake** placeholder (see §4.1).
- **Enrichers** are registered by plugins (`registerImportEnricher`), declared per data
  source via an `enrichWith` map in `dataSourceConfig.yml`, and run **at import time**.
  Each enricher writes to its own key in a generic `metadata: Json?` column on
  `Participant` / `ParticipantGroup` — **never flat-merged**, one key per enricher. An
  enricher may return `null` (no data, no key written) or throw (recorded in the
  `importErrors: Json?` map).
- **Import-error filtering.** Entities with a non-empty `importErrors` (or `deletedAt`)
  are excluded from kiosk lookups via a shared `NO_IMPORT_ERROR_WHERE` fragment. The
  `/admin/checkin` staff info panel (`StaffInfoPanel.tsx`, backed by
  `GET /admin/sessions/:id/context`) **deliberately bypasses this filter** so staff see
  data errors the kiosk hides.
- **Session abort.** `session:abort` (idempotent, sets `abortedAt`, returns client to
  the start screen) is the existing mechanism used by idle-timeout and by
  `confirmReCheckin`'s cancel. Reuse it; do not invent a new message type.

---

## 2. The flow (final, ordered)

Compliance checks come **before** any data display, so a failure aborts cheaply without
first collecting/showing diet or attendance info.

| # | Step | Status | Blocking? |
|---|------|--------|-----------|
| 0 | Identify | built | — |
| 1 | Compliance: Trygga Möten + registerutdrag | **build** | yes |
| 2 | Verify person | **build** | no |
| 3 | Goodiebag | small build / open | no |
| 4 | Done | built + trivial relabel | — |

---

## 3. Step 0 — Identify ("Kolla så att du är du")

**Status: already built. No changes expected.**

Sequence: `base:identify` → `base:setActorAsSubject` → `base:confirmReCheckin` →
`base:deduplicateSession`.

- `identify` accepts personnummer or QR/card scan (`useBarcodeScanner`).
- `setActorAsSubject` makes the person their own subject, so `selectSubjects` is trivial
  for staff (just themselves) and can be skipped/auto-passed.
- `confirmReCheckin` only shows a dialog if `Participant.confirmedCheckedInAt` is already
  set (already-checked-in → "check in again?"); silent pass otherwise. It is already
  scoped to the on-site self-check-in branch (`staff`/`stormote6_ordinary`).

---

## 4. Step 1 — Compliance: Trygga Möten + registerutdrag

**Status: build. This is the core new work.**

This replaces the fake `scoutnet:checkLeaderRequirements` (see §4.1) with a real,
enricher-backed compliance gate, wired to `staff` (the fake one was wired only to
`groups` and never ran for staff).

### 4.1 What exists today (remove/replace)

`scoutnet:checkLeaderRequirements` is a placeholder: it randomises a warning
(50/50 on a hash of the *actor's* UUID, not per subject) and shows hardcoded fake names
("Annette Hittepå", "Frans Finnsinte"). No real Trygga Möten or registerutdrag data
exists in the data model. It is wired only into the `groups` branch of `stepConfig.yml`.
Replace its logic; do not keep the random behaviour.

### 4.2 Design

Build **one plugin** that registers both the enricher(s) and one gate step. Both statuses
are enricher-provided (import-time snapshot), **not** live per-session API calls — this
is required so the same data can back the pre-camp "leaders missing TM/registerutdrag"
report (see §7).

- **Enrichers** write two separate metadata keys, e.g. `metadata.tryggaMoten` and
  `metadata.registerutdrag`. May be two enrichers or one enricher writing both keys; keep
  the keys separate regardless (never flat-merge).
  - **Trygga Möten** source: available via API. The enricher calls it at import time.
  - **Registerutdrag** source: a **merge of two sources** — the primary Swedish-staff
    status, plus an Excel list that backfills entries missing from the primary source
    (notably IST/international staff, who are not in the Swedish source). Some people will
    have **no entry in either** — that is an expected state, not an error.
- **Gate step** (position 1 in the `staff` branch): displays both statuses on one screen
  and enforces the rule below.

### 4.3 Blocking rule (decided)

**Proceed only if Trygga Möten is OK AND registerutdrag is OK. Otherwise block.**

- Registerutdrag "flagged/has a record" and "no entry at all" both count as **not OK**
  (collapse them for the gate decision).
- "Block" means **stop the digital flow and route to human handling — not reject the
  person.** Mechanically this is `session:abort`, but the screen copy must tell the
  operator what to do next rather than implying the person is turned away:
  - TM missing → have them complete Trygga Möten on the spot, then re-check-in.
  - Registerutdrag bad → special handling per "Truls dokument" (out-of-app process).
- Although it's one screen, the failure copy should reflect **which** requirement failed
  (TM vs registerutdrag), since the human follow-up differs.

### 4.4 The on-the-spot fix loop (decided)

Because statuses are an import-time snapshot, a fix made at the desk is not visible until
data is re-imported. **Decision: re-import when fixed.** After the person resolves TM (or
their registerutdrag entry is added to the Excel backfill), trigger a re-import; the
re-check-in then reads the corrected status and passes. No manual operator override and
no targeted single-person re-enrich are being built. This is acceptable because these
cases should be rare (the pre-camp email list, §7, catches most ahead of time).

---

## 5. Step 2 — Verify person ("Verifiera ifylld person")

**Status: build. Cleanest as a dedicated event-specific plugin** (e.g. `jamboree26:*`)
registering its enricher(s) and its screen together. The registerutdrag enricher from §4
may live in this same plugin if convenient (the enricher is position-independent since it
runs at import; only its gate step is pinned to position 1).

The screen displays, and where noted records:

- **Absence days** — specifically the days the person marked they are **not** attending
  ("vilka dagar de fyllt i att de *inte* är med"). Source: Scoutnet registration
  questions → enricher. Likely requires the Scoutnet `/questions` endpoint (not currently
  implemented in `scoutnet.ts`; see §6).
- **Specialkost** — display-only. Same Scoutnet-questions enricher source.
- **Next destination** — "vem ska du till härnäst" / "här ska du vara vid denna tiden
  imorgon". Function-dependent, keyed off the person's subGroup/function. No data source
  exists for this yet; a new enricher/lookup is needed if the app is to show it rather
  than leave it verbal.
- **Recorded yes/no** — "Har du upprättat kontakt med någon som ansvarar för dig?
  → Ja/Nej". This answer must be **stored** (it is not just an "I've read this" gate), so
  it belongs in this custom screen, not in `requireAcknowledgement`.

---

## 6. Step 3 — Goodiebag

**Status: small build. One open decision.**

A message-style screen for handing over the goodiebag (märke, halsduk, possibly
presentkort, possibly namnskylt). **Non-blocking** — the doc says it "kan ske senare", so
the operator must be able to proceed whether or not the box(es) are ticked, while the
answer is still recorded.

Two implementation options (pick one):

1. **Extend `base:message`** so `requireAcknowledgement` can be *optional* — records the
   check but does not gate the confirm button. Smallest change.
2. **New `base:checklist` step.** More expressive and the better fit, since the handout is
   several distinct items — a checklist captures *which* items were given, not a single
   "done". Larger build.

Recommendation: checklist, given the multiple items. Confirm before building.

---

## 7. Step 4 — Done ("Slut")

**Status: built; only a trivial relabel needed.**

`base:markConfirmedCheckedIn` → success message.

- Do **not** require acknowledgement on this step.
- Relabel the button "Slutför" → "Nästa" to reflect that the flow auto-restarts to the
  next person (it does not feel like an end).
- Idle-timeout (45s inactivity → 10s countdown → `abortedAt`) and auto-restart wrap the
  whole flow; kiosk only. Already built.

---

## 8. Cross-cutting

- **Staff-only / unassigned handling.** People not assigned a function, or whose import
  errored, are hidden from the kiosk by the `NO_IMPORT_ERROR_WHERE` filter by design. The
  `/admin/checkin` `StaffInfoPanel` bypasses that filter and is the place to surface a
  clear **internal, staff-only** message for these cases (the external/internal message
  split is an explicit requirement). No new plumbing needed beyond honouring this.
- **International / IST.** Not necessarily in Swedish Scoutnet. The registerutdrag Excel
  backfill (§4) is the mechanism for their registerutdrag status. A paper list keyed by
  membership number is the operational fallback for identification. "Internationell safe
  from harm" remains an open **policy** question that affects step 1 for these people.

---

## 9. Data / external dependencies (not code, but blocking)

- **Registerutdrag primary (Swedish) source** — depends on an external order ("Carl på
  kansliet"). The Excel backfill covers IST/missing entries.
- **Scoutnet `/questions` integration** — needed for absence days + specialkost in step 2;
  not implemented in `scoutnet.ts` today. Deciding to build this is what unblocks the
  step-2 enrichers.
- **Trygga Möten API** — available; the enricher must be written against it.

---

## 10. Explicitly out of scope

- **Checkout / utcheckning** (funktionärsutcheckning). Wanted eventually, explicitly not
  self-service, but nothing in the data model or existing flow supports it. Not part of
  this check-in spec.
- The mobile pre-check-in flow (`groups`-only).

---

## 11. Reference points in the existing codebase

- On-site flow config: `packages/backend/config/stepConfig.yml`
- Data source config: `dataSourceConfig.yml` (`enrichWith` map, `subGroupConditions`)
- Fake plugin to replace: `scoutnet:checkLeaderRequirements`
  (`LeaderRequirementsWarningScreen.tsx`), wired at the `groups` branch (`stepConfig.yml`)
- Enricher API: `registerImportEnricher` (`packages/plugin-api/src/backend/index.ts`),
  `EnricherRegistry` (`core/workflow/enricherRegistry.ts`), run from
  `reconcileDataSource` (`data.service.ts`)
- Metadata / error fields: `metadata Json?`, `importErrors Json?`, `deletedAt DateTime?`
  on `Participant`/`ParticipantGroup` (`schema.prisma`); shared `NO_IMPORT_ERROR_WHERE`
  filter (`data.service.ts`)
- Admin check-in view: `routes/admin/checkin.tsx`, `components/admin/StaffCheckin.tsx`,
  `StaffInfoPanel.tsx`, `GET /admin/sessions/:id/context` (`session.service.ts`)
- Session abort: `session:abort` (`session.socket.ts`), `abortSession` (`session.service.ts`)
- Existing step to extend for goodiebag option 1: `base:message`
  (`plugins/base/src/message/backend/message.ts`, `requireAcknowledgement`)
