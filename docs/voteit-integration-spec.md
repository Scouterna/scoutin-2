# VoteIT integration — design spec

Target: a new **`voteit`** plugin for Demokratijamboree 2026, granting the *potential
voter* (`pv`) role in VoteIT when a participant checks in on-site.

This is a living design document, not a config file. It records the API contract as
currently understood, the decisions already made, and the questions still open with
VoteIT. Sections marked **OPEN** are unresolved and must not be guessed at during
implementation.

---

## 1. Context

Participants in VoteIT do **not** hold the voter role when they are added to the event.
They receive it only on physical check-in, and Scoutin is the system that grants it.

Identity is governed by **membership number** (medlemsnummer).

Facts that shape the whole design — established before implementation, and the reason
the threat model in §8 lands where it does:

- **Check-in is per-person.** Participants check themselves in. No group check-in, so no
  path where one actor enfranchises a delegation.
- **`pv` is an eligibility flag, not a credential.** It marks a user as holding voting
  rights. To actually vote, the person signs in to VoteIT with **ScoutID**. Scoutin never
  confers the ability to vote, only the entitlement.
- **The POST can create invites, and must never be allowed to.** If no invite matches the
  identifier, VoteIT **creates one**. Scoutin's job is to grant `pv` to people who are
  already invited; minting invites is not a capability we want and not one we should be
  able to exercise by accident. See §2.3 — this constraint is ours to enforce, and it is
  the single most important invariant in the integration.
- **Two voting channels, mutually exclusive.** Check-in also hands over a physical voting
  card, as it always has. A given vote is either digital or physical, never both.
  Scoutin neither enforces nor observes that exclusivity — we depend on VoteIT for it.

---

## 2. The VoteIT API

Base: `https://scouterna.voteit.se/token-api/`

**Trailing slashes matter.** Every path below ends in `/` and must be sent that way.

Auth: `Authorization: Api-Key <key>`. A single key for the whole event.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/token-api/invites/` | List all invites. How we resolve a membership number to a pk. |
| `GET` | `/token-api/invites/:pk/` | Fetch a single invite — current roles and `user_data`. |
| `POST` | `/token-api/invites/` | Update an invite. |

### 2.1 The POST is really a PUT

It is idempotent, but it **replaces** rather than merges. The `roles` array must contain
every role the invite already has *plus* `pv`. Read-modify-write is mandatory; sending
`["pv"]` alone strips the participant's other roles.

```json
{
  "roles": ["pa", "di", "pr", "pv"],
  "data": [
    { "email": "malcolm.nihlen+voteittest@gmail.com" }
  ]
}
```

### 2.2 Identifier

`data` currently supports **email only**. VoteIT will add **membership number** as an
identifier before the event. See §5 — we build membership-number-native regardless.

### 2.3 The POST is upsert, not update

**If the identifier in `data` matches no existing invite, VoteIT creates a new invite
with the roles given.** There is no create-vs-update distinction at the API level and no
way to ask for update-only semantics. A single POST with a wrong identifier does not fail
— it silently produces a brand-new invite carrying `pv`.

So the "only touch existing invites" rule lives entirely in Scoutin. The flow in §3
already enforces it structurally: we only ever POST after resolving a pk from the list
*and* confirming the invite with a fresh single-invite `GET`. Every identifier we write
is one VoteIT just handed us.

Three consequences worth stating plainly, because each is a way to lose the invariant:

1. **The error branch must never POST.** Not found after a fresh list fetch means show an
   error — never "create it so they can vote." That shortcut will look extremely
   attractive at 08:30 on event day with a queue building and someone insisting they were
   invited. It must not be reachable from Scoutin at all; if a genuine invite is missing,
   that is VoteIT's side to fix.
2. **Never construct an identifier.** No identifier may come from Scoutin's own
   participant record, from the dev map, or from user input — only from a VoteIT response
   in the same operation. See §5.2, which is now load-bearing rather than hygiene.
3. **Enforce it in the type signature, not in a rule.** The write function should take
   the fetched invite object and extract the identifier internally:

   ```
   grantPotentialVoter(invite: FetchedInvite): Promise<void>
   ```

   No overload accepting a bare membership number, email, or pk. Then "we only write
   identifiers we just read" is impossible to violate without deliberately constructing a
   fake `FetchedInvite`, rather than being a convention that erodes under deadline.

### 2.4 Known characteristics

- No pagination on the list endpoint (to be confirmed — see §6).
- Two invites should not be able to share a membership number.
- No atomic-update / precondition mechanism is known to exist (see §6).

---

## 3. Check-in flow

```
membership_number
  → cache lookup (list of invites)  ── miss ──> refetch list ── miss ──> error
  → pk
  → GET /invites/:pk/               (fresh roles + user_data)
  → assert user_data.membership_number == the number we started check-in with
  → POST /invites/  { ...existing roles, "pv" }
```

Rules:

1. **Never trust cached roles.** The pk comes from the cached list; the roles always come
   from a fresh single-invite `GET`. A stale role set would be clobbered back on write.
2. **The mismatch gate.** Before writing, confirm the fetched invite's membership number
   is the one the check-in started with. The cached pk may be stale.
3. **A mismatch is treated as a cache miss, not an error.** A pk resolving to the wrong
   membership number is evidence of the same staleness a miss indicates. Refetch the
   list, retry once, then error. This keeps the two staleness paths consistent.
4. **One retry, then fail.** If the participant is absent after a fresh list fetch, show
   an error. Do not loop.

**Blocking: OPEN, and it is the highest-stakes decision in the spec.** The step is
expected to block, because downstream steps depend on its outcome. But blocking makes
VoteIT's availability a hard dependency of the check-in queue — see §8.2, which argues
this is the most likely event-day failure by some margin. Decide it explicitly, not by
default.

---

## 4. Caching and single-flight

The full invite list is cached. It is **only refetched on a miss** — so the first
check-in of the event triggers the first fetch.

### 4.1 Use the existing JobRunner

`packages/backend/src/core/jobs/jobRunner.ts` already provides exactly the needed
primitive. It enforces a single-in-flight run per named job, isolates errors, and drains
on shutdown.

Its `fresh` option is the important part. A plain `runNow` **coalesces** onto an
in-flight run; `fresh: true` guarantees a run that *starts after* the call, queueing one
follow-up behind the current run and sharing it among all callers.

This distinction is load-bearing. On a cache miss we must not coalesce onto a fetch that
started before our lookup — that fetch may be the very one whose response lacked our
participant. Cache misses therefore use `fresh: true`, then re-check the cache.

The doors-open stampede (many kiosks missing a cold cache at once) collapses to a single
follow-up fetch for free.

### 4.2 Plugins cannot register jobs today

`BackendPluginContext` (`packages/plugin-api/src/backend/index.ts`) exposes exactly two
methods: `registerStep` and `registerImportEnricher`. There is no route registration, no
admin-UI contribution, and no job registration. `plugin-services.ts` — the escape hatch
plugins use to reach host internals — does not export the job runner either.

**Proposed:** add `registerJob` to `BackendPluginContext`. JobRunner already handles
scheduling, error isolation and shutdown drain, and the admin API already surfaces
`JobStatus`, so a plugin-registered job appears in the existing jobs UI with no new admin
surface. This is a far smaller lift than general plugin admin pages, and it buys both
cache warming and a manual "refresh invites" trigger.

Without it, the cache stays lazy and the first participant of the event waits for the
full list download at the desk.

---

## 5. Identity: the membership-number gap

VoteIT will support membership numbers before the event, but **today the field is not
present in `user_data` at all** — the gap is in the data, not just in the write
identifier.

### 5.1 Decision: decorate at the API boundary, do not map at the front

A single `normalizeInvite()` is applied to every invite as it arrives, from **both** the
list fetch and the single-invite `GET`. In development it fills in
`user_data.membership_number` from a hard-coded reverse email → membership number map
**when the field is absent**. In production it is a no-op, because the field is already
there.

The placement is the point. A map at the front of the flow — membership number straight
to email or pk — would leave the list search, pk resolution, mismatch gate and
not-found→refetch→retry path as dead code until VoteIT ships. A decorator at the boundary
lets every one of those run for real against real VoteIT data. An invite whose email is
not in the map simply has no membership number, which is indistinguishable from a real
invite that lacks one, so even the miss path is exercised honestly.

Filling only when absent also makes the switchover a non-event: real data wins
automatically as it starts arriving. No flag day, no coordinated deploy.

### 5.2 Write identifier

One function turns a membership number into the `data` entry — `[{ email }]` today,
`[{ membership_number }]` once available. Nothing above that function handles an email.
The mismatch gate is membership-number based in both worlds, so the safety logic is
written against the final shape from day one.

**Where today's email comes from — this is a hard rule, not a preference:** the freshly
fetched invite, never Scoutin's participant record. We only ever write back an email
VoteIT just told us about.

Scoutin's own email may have drifted, and because the POST upserts (§2.3), writing a
drifted email does not touch the wrong record — it **creates** a new invite carrying
`pv`. That makes this the load-bearing control against phantom voters, which is why the
write function takes a `FetchedInvite` rather than an identifier: the rule is enforced by
the type signature instead of by remembering it.

### 5.3 Guards

- The dev map must be **structurally incapable of reaching production**: config-gated,
  with the service refusing to start if the map is populated outside development. Not a
  comment saying "remove before the event."
- Read the membership-number field through a **single accessor**, so a wrong guess about
  its name or type is a one-line fix.
- **Fixture-based tests for the mismatch gate**, built from a hand-written payload with
  the field populated, so the safety logic has coverage independent of both the live API
  and the map.

### 5.4 Residual risk

We are guessing the field's name, type and position in `user_data` (zero-padded string or
integer? nested how?). A wrong guess passes in dev and matches nothing at the event.
It would degrade into the not-found path and present as *every* participant failing —
loud rather than silent, which is the better failure, but still an event-day outage.
Get the exact shape from VoteIT before implementation.

---

## 6. OPEN — questions for VoteIT

1. ~~**What does the POST do with an identifier matching no invite — 404, or create?**~~
   **ANSWERED: it creates.** Any drift between Scoutin's and VoteIT's records silently
   mints a new invite carrying `pv`. Fully specified in §2.3; the invariant that prevents
   it is ours to enforce.
2. **What does the POST return?** If it echoes the resulting invite, we can assert the
   returned membership number after the write and close most of the read-write window.
3. **Is `data` a batch?** It is an array, but `roles` is a single shared array, so a
   multi-entry call would mean "set identical roles on all these people" — incompatible
   with read-modify-write. Assumed to be exactly one entry.
4. **Exact shape of the membership number in `user_data`** — field name, type, nesting.
5. **Any precondition mechanism** — ETag, `If-Match`, a `modified` timestamp? Determines
   whether the lost-update window in §7 is closeable or merely accepted.
6. **Is the list endpoint really unpaginated, and how large is the payload?** Determines
   whether "fetch the whole list" stays viable at stämma scale.
7. **Role vocabulary** — confirm the meanings and full set (`pa`, `di`, `pr`, `pv`), and
   that `pv` is the only role Scoutin ever adds.

---

## 7. Known gaps

**Lost update on the roles array.** Between the single-invite `GET` and the `POST`,
anything else that changes roles gets clobbered. Two kiosks will not collide (different
people), but a VoteIT admin editing roles during check-in would. Closeable only if a
precondition mechanism exists (§6.5); otherwise accepted knowingly.

**Read key ≠ write key (until membership numbers ship).** We find and confirm by
membership number, then write by email. The gate proves "the invite at this pk has the
right membership number"; the write targets "whatever invite has this email". Mitigated
by taking the email from the fetched invite (§5.2), and eliminated entirely once the
write is keyed the same way as the read.

Because the POST upserts (§2.3), the failure mode here is worse than touching the wrong
record: an email that matches nothing **creates** a new invite with `pv`. This is why
§5.2 is a hard rule and why the write takes a `FetchedInvite` rather than an identifier.
It is also a second, independent argument for the boundary-decorator design in §5.1 — the
dev map only ever influences *lookup*, never the identifier we write, so a stale entry in
it can cause a failed match but cannot mint a voter.

---

## 8. Threat model and failure modes

The headline: **the dangerous failures here are not "the API call errored" but "the API
call succeeded against the wrong record."** Availability and correctness dominate;
malicious actors are a distant third. That conclusion is not an assumption — it follows
from the three facts in §1, and it should be revisited if any of them change.

### 8.1 Why the attack surface is narrower than it first appears

Scoutin's identify step performs **identification, not authentication**.
`base:identify` accepts an arbitrary string from the client, hashes it, and exact-matches
it against `lookupValues` (`plugins/base/src/identify/backend/identify.ts`), which
contain exactly two things: **membership number** and **personnummer**
(`domains/participants/scoutnet.ts`). Both are hashed at rest — good against a database
leak, irrelevant to someone at a kiosk who simply knows the number. Neither is a secret:
membership numbers are on badges and in every leader's roster, and personnummer is not
secret in Sweden.

That would be alarming if check-in conferred the ability to vote. It does not:

- **Impersonation transfers nothing usable.** Checking in as someone else grants `pv` to
  *their* invite, which only *they* can exercise via ScoutID. The impersonator gains no
  vote.
- **No group amplification.** Check-in is per-person.
- **No double-vote via the physical card**, because the channels are exclusive.

**The residual risk is presence fraud, not identity theft.** A delegate who does not
attend arranges to be checked in, then votes digitally from elsewhere. Note the shape:
the "victim" is a willing collaborator, and the person voting is genuinely entitled to
vote. It defeats the present-to-vote rule, and at scale a bloc could enfranchise its
absent members.

**Decision: do not build kiosk-side double-verification.** Badge-possession credentials,
ID checks at the desk, or codes to a registered address would defend only against
collusive proxy check-in by people already entitled to vote. That is a poor trade against
slower queues and badge logistics. Membership number is a defensible identifier *given*
that ScoutID gates the vote. **If that ever stops being true — if `pv` alone becomes
sufficient to cast a ballot — this decision must be reopened immediately.**

### 8.2 Ranked risks

1. **Availability (highest).** If the step blocks and VoteIT is slow or down on the
   morning of, the check-in queue stops and nobody gets enfranchised. Far more likely
   than any attacker. Drives the §3 blocking decision, and argues for an explicit answer
   to: should a VoteIT failure hard-stop check-in, or complete it, flag it, and retry?
2. **Wrong-record writes, including phantom-voter creation.** The §7 gaps — read key ≠
   write key, no atomic update — combined with the upsert semantics of §2.3. Writing
   `pv` to the wrong invite enfranchises someone not entitled; writing an identifier that
   matches nothing **creates an entitled voter who was never invited**. Neither needs an
   adversary. This is a bug we could ship, which makes it the top *integrity* risk, and
   the creation variant is qualitatively worse than anything in §8.1 — presence fraud
   merely lets an entitled person vote while absent, whereas this manufactures
   entitlement outright.
3. **Role stripping.** The POST replaces rather than merges, so a bad read, a truncated
   response or a logic error removes roles instead of adding one. Disenfranchisement is
   as much a failure as false enfranchisement and is far easier to cause by accident.
4. **Presence fraud.** Per §8.1 — accepted, not mitigated.
5. **API key compromise.** A leaked key is a mass presence-fraud button: grant `pv` to
   every invite at once. Bounded by ScoutID (each person still has to choose to vote)
   and reversible if we have revoke and audit.

### 8.3 Controls to build

Prevention is not the lever here — a membership number cannot be made secret, and the
top two risks are not adversarial at all. Detection, reversal and blast-radius control
are.

- **Make phantom-voter creation unrepresentable.** `grantPotentialVoter` takes a
  `FetchedInvite`, never a bare identifier, and no code path constructs one (§2.3). This
  is the highest-value control in the list, because it converts the integration's most
  serious failure from a rule someone must follow into a thing the compiler refuses.
- **Audit every grant.** `domains/audit/audit.service.ts` already provides `recordAudit`.
  Record actor, membership number, kiosk, timestamp, and **roles before and after**. The
  before/after pair is what makes an anomaly reconstructable rather than merely visible.
- **Build a revoke path.** There is currently none, so a bad grant is permanent and any
  incident becomes an argument instead of a fix. Mechanically trivial — the same POST
  without `pv` — but it needs to exist and be operable under pressure.
- **Assert supersets on write.** Refuse to send a roles array that is not a strict
  superset of what the read returned, and refuse to write at all if the read looks empty
  or malformed. This is the guard against risk 3.
- **Verify after write, if the POST echoes the invite** (§6.2). Asserting the returned
  membership number closes most of the read-write window.

### 8.4 API key handling

**Do not encrypt it at rest.** The process must decrypt it to use it, so an attacker who
owns the host owns the key either way. It buys ceremony, not security. What actually
matters:

- **Never logged.** The realistic leak path is error handling that dumps request headers
  or a whole fetch config. Redact `Authorization` explicitly in the plugin's error paths
  rather than relying on nobody logging the wrong object.
- **Never committed.** Check `bruno/` before this lands — API collections are a classic
  place for keys to be committed by accident.
- **Rotate after the event**, and confirm with VoteIT what rotation involves.
- **Ask whether a narrower key exists.** One key for the whole event can modify roles on
  every invite.

Note that `DATASOURCE_HASHING_KEY` is not a precedent for encrypting this — it
pseudonymizes lookup values at rest, a different purpose.
