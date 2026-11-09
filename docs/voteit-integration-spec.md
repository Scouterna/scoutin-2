# VoteIT integration — design spec

Target: a **`voteit`** plugin for Demokratijamboree 2026 that grants the *potential
voter* role (`pv`) in VoteIT when a delegate checks in on site.

Rewritten 2026-11-09 against the finished VoteIT token API, read from its source
([VoteIT/voteit](https://github.com/VoteIT/voteit), `voteit/token_api/`). The first
draft (`45c0026`) designed around a POST that upserted invites and replaced their
roles. That endpoint still exists, but we don't use it, and most of the draft's
machinery (list cache, single-flight refetch, dev email map, read-modify-write
guards) is gone with it.

---

## 1. Context

- Delegates are invited to the VoteIT meeting beforehand without `pv`. They get it
  only when they check in on site, and Scoutin is what grants it.
- `pv` is an eligibility flag, not a credential. Voting still needs a ScoutID login,
  so granting `pv` never lets anyone but the invitee vote.
- Check-in is per person. Check-in also hands out a physical voting card; a vote is
  digital or physical, and VoteIT, not Scoutin, keeps those apart.
- Identity is the Scoutnet membership number. In Scoutin it is the participant's
  `idInDataSource`; in VoteIT it is the invite's `user_data.member_id`, the same key
  ScoutID logins are matched on.

## 2. The VoteIT token API

Hosts:

| Environment | Base URL | Meeting |
| --- | --- | --- |
| Test | `https://d1.betahaus.net` | 81, "Labbmöte Scouterna 2026" |
| Production | `https://scouterna.voteit.se` | the DJ26 meeting |

Auth: `Authorization: Api-Key <key>`. A key belongs to exactly one meeting, so no
meeting id is ever sent. Paths end in `/`.

Endpoints we use:

| Call | Scope | Purpose |
| --- | --- | --- |
| `GET /token-api/invites/?member_id=<no>&state=open,accepted` | `invites.list` | Find the delegate's invite. Filtered on the server; not paginated. |
| `POST /token-api/invites/<pk>/add-roles/` `{"roles": ["pv"]}` | `invites.add_roles` | Grant. Returns the invite. |
| `POST /token-api/invites/<pk>/remove-roles/` `{"roles": ["pv"]}` | `invites.remove_roles` | Revoke. Returns the invite. |

Behavior that matters (verified in the source):

- **add-roles merges on the server**, inside a transaction with the row locked.
  Roles the invite already has are kept; required roles follow (`pv` brings `pa`).
  Granting twice is a no-op.
- **add-roles is addressed by pk, so it can't create an invite.** We never call
  `POST /token-api/invites/` (create). It *does* upsert: an unknown identifier
  creates a new invite. The key must not have the `invites.create` scope, so that
  mistake is impossible rather than merely avoided.
- **Moderators are off limits.** Changing an invite that carries `mo`, or one
  accepted by a moderator, returns 400.
- `member_id` is a string, whitespace-trimmed. The filter normalizes the value the
  same way.
- Invite `state` is one of `open`, `accepted`, `rejected`, `revoked`, `expired`.
  An accepted invite's roles are synced to the user in the meeting.
- Throttle: the default is 60 requests/min per key. One check-in is two requests,
  so about 30 check-ins a minute. **Ask VoteIT what the production rate is.**

Invite as returned (relevant fields):

```json
{ "pk": 123, "meeting": 81, "state": "open",
  "user_data": { "member_id": "3001234" }, "roles": ["pa", "pv"],
  "used_by": null, "has_annotations": false }
```

## 3. The step: `voteit:grantVoterRole`

```yaml
- if: ${{ session.subjects[0].subGroup == 'delegate' }}
  uses: voteit:grantVoterRole
  id: voteit
  with:
    memberId: ${{ session.subjects[0].idInDataSource }}
```

Flow on step start:

1. `GET invites/?member_id=<memberId>&state=open,accepted`.
2. Zero invites: **not invited** (error screen). More than one: **ambiguous** (error
   screen). Never fall back to creating anything.
3. One invite, `roles` already has `pv`: `alreadyGranted` (see the confirmation below).
4. Otherwise `POST invites/<pk>/add-roles/ {"roles": ["pv"]}`.
5. Check the response: same `pk`, same `user_data.member_id`, `roles` contains `pv`
   and everything the invite had before. Anything else is an error.
6. `granted`.

On success (`granted` or `alreadyGranted`) the audit and result data are written at
once, but the step does not complete yet. It shows a confirmation, "Your voting rights
are registered", the same for both. It describes what Scoutin did, not what VoteIT
allows: the invite can carry `pv` while a moderator has removed it from the
participant, and a second check-in then leaves it removed (VoteIT syncs invite roles
to the participant only when the invite changes). Moderators revoke on the
participant, not the invite; a revoke on the invite is undone by a second check-in. The screen keeps
the spinner for at least 2 s, then shows the confirmation until the person presses
"Continue", which calls the public method `continue` and completes the step with
the outputs below. There is no auto-continue: the person should see that they got
voting rights. `continue` is ignored unless the step is in the granted state, so a
double press completes once.

The membership number is read from an invite through one accessor
(`inviteMemberId(invite)`), so a change on VoteIT's side is a one-line fix.

**Outputs:** `{ status: "granted" | "alreadyGranted" | "skipped", invitePk?: number }`.

**Result data** (`writeResultData`, on the subject): the same object plus a
timestamp, so staff can list who was skipped and grant them later.

**Barrier:** `preventGoBack: true`. The grant is a side effect outside Scoutin.

### 3.1 Failure: block, with a skip

Decided 2026-11-09 (owner): the step blocks, and the person can skip.

Every failure (network error, timeout, 4xx/5xx, not invited, ambiguous, failed
response check) shows one error screen with:

- **Try again**: reruns the flow.
- **Continue without digital voting**: completes the step as `skipped`. The screen
  tells the person to see the staff desk; they still get a physical voting card.

The skip needs no staff gate. It can only cost the person their digital vote, never
give one. It is audited and recorded on the participant like a grant.

Requests time out after 10 s.

## 4. Audit

Every outcome writes an audit row through `recordAudit` (exported to plugins via
`plugin-services`): action `voteit.grant`, `voteit.alreadyGranted`, `voteit.skip` or
`voteit.revoke`, with session id, participant id, membership number, invite pk,
roles before and after, and for a skip the error that caused it.

## 5. Configuration and the key

- `VOTEIT_BASE_URL` and `VOTEIT_API_KEY`. If a loaded step config uses a `voteit:`
  step and either is missing, startup fails.
- Key scopes: `invites.list`, `invites.add_roles`, `invites.remove_roles`. **Not**
  `invites.create` or `invites.*`.
- The key is never logged. Errors are built from status and body only, never from
  the request or headers. Don't put it in `bruno/`.
- No encryption at rest: the process has to read it either way. Rotate after the
  event.

## 6. Revoke

Decided 2026-11-09 (owner): no revoke tool in Scoutin. Scoutin is not the source of
truth for `pv`: it grants once at check-in and never reads it back or re-syncs it.
Revokes and late grants for skipped delegates are done by a VoteIT moderator in the
VoteIT UI. The participant's result data then only records what check-in did.
The key keeps `invites.remove_roles` but nothing in Scoutin uses it.

## 7. Threat model, short

The dangerous failure is a call that succeeds against the wrong invite, not one that
errors.

- **Creating a voter who was never invited:** impossible. We only call add-roles by
  a pk VoteIT just returned for that membership number, and the key has no create
  scope.
- **Stripping roles:** impossible. The server merges.
- **Granting the wrong person:** the lookup is by membership number on VoteIT's
  side, and the response check confirms the number. Duplicate invites for one number
  are refused, not guessed between.
- **Availability:** VoteIT down means each delegate sees the error screen and can
  skip. The queue keeps moving and the skipped list says who to fix later.
- **Presence fraud** (checking in an absent delegate who then votes digitally):
  accepted. A membership number isn't secret, and kiosk-side verification would
  slow every queue to stop only collusion between people who may vote anyway.
  Reopen this if `pv` ever becomes enough to vote without ScoutID.
- **Leaked key:** lets someone grant or revoke `pv` on any invite in the meeting,
  still bounded by ScoutID. Audit plus revoke make it reversible.

## 8. Testing

- Unit tests with a stubbed `fetch`: not invited, ambiguous, already granted,
  granted, response mismatch, HTTP error, timeout, skip.
- Against the test meeting (81) with a test key, once the owner provides one.
