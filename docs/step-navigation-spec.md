# Step navigation: barriers and locks — design spec

> **Implemented (backend and plugin-api).** The frontend part is still open.
> Deviations from the text below:
>
> - `preventGoBack` exists only on the step implementation. A config-level override
>   was dropped because nothing needs it; it can be added later without breaking
>   anything. The `skipOnGoBack` + `preventGoBack` contradiction is rejected when the
>   step is registered (`StepRegistry.register`), not when a config is loaded.
> - `canGoBack` is `false` for a completed or aborted session, matching the
>   existing refusal to go back there.
> - A refused `goBack` for the lock (kiosk, locked) re-sends the navigation state
>   only; it does not log as a barrier refusal.
> - The lock is also cleared inside `abortSession`, so every abort path releases
>   it.
> - There is no admin abort route. A staff connection can already send
>   `session:abort`, and the admin session view connects with a staff token, so
>   its abort button needs nothing new on the backend.
> - No lock reason: the lock is a boolean, and `session:navigation` carries
>   `{ canGoBack, locked }`.
> - The navigation state is not cached for replay. An admin takeover computes it
>   fresh next to the replayed screen; a first connection restarts the step,
>   which sends it.
> - Check-in links (`/from-link`) and kiosk sessions both get
>   the `kiosk` role; only `POST /admin/sessions/:id/token` issues `staff`.

Target: two generic step-engine features.

- **Barrier:** a completed step that you can't go back past.
- **Navigation lock:** a temporary state in which the current step prevents the
  kiosk from navigating away.

Neither is specific to printing, but `printer:print`
([printer-proxy-spec.md](printer-proxy-spec.md) §9) is the first consumer and the
reason to build them now.

This is a living design document. Sections marked **OPEN** are unresolved.

---

## 1. Context: what exists today

- **`skipOnGoBack`** (`packages/plugin-api/src/backend/index.ts:122`) is the only
  per-step navigation flag. Going back steps *over* such a step (rolling it back
  silently) and continues to the previous one. Used by `base:deduplicateSession`.
- **The only point of no return is session completion.** `goBack`
  (`packages/backend/src/core/workflow/step.ts:148`) refuses on completed or aborted
  sessions. The comment there explains why the guard belongs in the backend:
  `step:goBack` can be sent directly, not just from the kiosk's back button.
- **Three clients send `step:goBack`:** the kiosk (`routes/_kiosk/index.tsx:28`),
  staff check-in (`components/admin/StaffCheckin.tsx:115`) and check-in links
  (`routes/link.$linkId.tsx:84`), plus the admin debug panel.
- **The kiosk back button** is shown whenever a screen is shown
  (`_kiosk/index.tsx:37`, `showBackButton={currentScreen != null}`). It first pops the client-side within-step
  `screenHistoryAtom`, and only sends `step:goBack` when that is empty.
- **The idle timeout** (`components/kiosk/IdleTimeout.tsx`) runs entirely on the
  client: 45 s of inactivity, then a 10 s countdown, then `session:abort`. Abort
  sets `abortedAt` and runs **no** rollback hooks.
- **Session tokens carry only a session ID** (`domains/sessions/tokens.ts`). A
  kiosk, a staff member in `/admin/checkin` and an admin watching a session
  (`POST /admin/sessions/:id/token`) are indistinguishable on the socket.
- **No admin endpoint aborts a session.** Only the kiosk idle timer and closing
  `StaffCheckin` send `session:abort`.

---

## 2. Barrier

### 2.1 Semantics

A **barrier step**, once completed, cannot be rolled back by `goBack`, and neither
can any step before it. Going back from the step after a barrier is refused.

The barrier exists to protect real-world side effects that can't be undone: a
printed badge, a role granted in another system. It applies to **every** client,
staff included. The way to reverse a finished check-in is the admin-level
`undoCheckin`, as today.

A step that is *in progress* is not yet a barrier. Navigation during that period is
covered by the lock (§3).

### 2.2 Declaring a barrier

The step implementation declares it, since it is inherent to what the step does:

```ts
export const print: StepImplementation = {
  id: "printer:print",
  preventGoBack: true,
  …
};
```

Adding `preventGoBack?` to `StepImplementation` is the whole API change. There is
deliberately no config-level switch: no flow needs to make an arbitrary step a
barrier today, and adding one later is backward compatible.

### 2.3 `goBack` must plan before it acts

`goBack` currently rewinds one step at a time, rolling back `skipOnGoBack` and
auto-completed steps as it goes until it reaches a normal step. If it simply
stopped at a barrier, it could already have rolled back some skip steps in front of
it, leaving the session half-unwound.

So `goBack` is split in two:

1. **Plan:** walk backwards over the completed steps *without side effects* and
   collect the steps that would be rolled back, up to and including the target
   (the first normal step). If a barrier is met before the target is reached, the
   plan is **refused**.
2. **Execute:** only if the plan is allowed, run `onStepRollback` and
   `deleteStepData` for each step in order, then `startStep` on the target. This is
   the same as today.

A refused `goBack` logs, sends nothing destructive, and re-sends the navigation
state (§4) so a client that showed a stale back button corrects itself.

The same `canGoBack(sessionId)` planning function also produces the `canGoBack`
flag sent to clients, so the button and the backend can't disagree.

### 2.4 Sub-flows (planned)

When nested sub-configs land, a barrier inside a sub-flow blocks going back into
or across that sub-flow from the parent. The planning walk covers all completed
step records regardless of which config they came from, so nothing special is
needed as long as the walk follows the same order as rollback.

---

## 3. Navigation lock

### 3.1 Semantics

A step can lock navigation **while it is in progress**. While locked, the kiosk:

- hides its back button, including within-step `screenHistoryAtom` navigation
- **fully disables the idle timeout**: no countdown and no auto-abort for as long
  as the lock is held. This is decided. A stalled print pool therefore keeps the
  kiosk on its waiting screen until staff abort it (§3.3); a badge must never come
  out while the next attendee is already checking in.

and the backend rejects `step:goBack` and `session:abort` from **kiosk**
connections.

Staff can always override (§3.3). A lock is a guard against the attendee, not
against staff.

### 3.2 API

```ts
await ctx.lockNavigation();
await ctx.unlockNavigation();
```

- **Async, and awaited.** Each call resolves once the new navigation state has been
  sent. The state needs a database read (`canGoBack`), so firing the broadcast in
  the background would let two quick calls arrive out of order and leave the
  client with a stale `locked`.
- **Ephemeral, held in memory** in the session registry, next to `lastScreen`.
  It's not persisted.
- **Cleared automatically** when the step completes, when the step is restarted,
  and when the session completes or is aborted. A step can't leak a lock.
- **Re-established by the step on resume.** After a backend restart or kiosk
  reconnect, `onStepStart` runs again and the step locks again if it still needs
  to (for example `printer:print` still waiting on its jobs). This is why it needs
  no persistence.

### 3.3 Staff override and roles

The backend has to tell kiosk connections from staff connections, and today it
can't (§1). Proposal: add a role claim to the session token.

```ts
{ "urn:scoutin:sessionId": "…", "urn:scoutin:role": "kiosk" | "staff" }
```

- Kiosk and check-in-link sessions get `kiosk`.
- Tokens issued through admin (`POST /admin/sessions/:id/token`, `StaffCheckin`)
  get `staff`.
- A token without a role is treated as `kiosk`, so existing tokens keep working
  (tokens live for 2 h).

While a session is locked:

| Action | `kiosk` | `staff` |
| --- | --- | --- |
| `step:goBack` | rejected | allowed (still subject to barriers) |
| `session:abort` | rejected | allowed |
| `step:callMethod` | allowed (the step decides) | allowed |

New: **an abort button in the admin session view**. That view already connects
with a staff token, so the button just sends `session:abort` on its socket. No
separate route is needed. This is how staff free a kiosk that's locked and stuck,
for example one waiting on a print pool with no healthy printers. (Opening the
view also disconnects the kiosk, since any second connection takes over.)

---

## 4. Telling clients

A new server → client message, registered in
`packages/backend/src/core/websocket/messageTypes.ts`:

```ts
.register("session:navigation", type({
  canGoBack: "boolean",      // a goBack would be allowed by barriers (§2.3)
  locked: "boolean",
}))
```

- **Sent** after every `step:started`, on every lock or unlock, and after a refused
  `goBack`.
- **Sent to an admin who takes over** a running session, computed fresh at that
  moment (the lock is in memory and `canGoBack` is derived from the step records,
  so nothing needs caching).
- **Kiosk back button:** visible when
  `!locked && (screenHistory.length > 0 || canGoBack)`.
- **`IdleTimeout`:** treats `locked` the same as "not in a session" (timer stopped).
- **`StaffCheckin` and the admin views** show the lock state instead of
  hiding controls, since staff can override. There is no lock reason: on takeover
  staff get the step's own screen replayed, which already says what it is doing.

---

## 5. `printer:print` as the first consumer

- `preventGoBack: true` on the implementation. Once its jobs exist, going back past it
  is refused, so the question of canceling queued jobs on go-back never comes up.
  `undoCheckin` leaves print jobs alone; staff cancel queued ones in admin if
  needed.
- `behavior: wait` locks navigation from job creation until
  every job is terminal, then unlocks and completes.
- `behavior: queue` completes immediately, so it never needs a lock.
- A kiosk stuck in `behavior: wait` (pool stalled) is freed by staff with the admin
  abort (§3.3). Its jobs keep going, because they live in the DB, not in the
  session.

---

## 6. Decided details

1. **Check-in links** (`link.$linkId.tsx`) run on the attendee's own phone. They
   follow the same rules. A phone user can always close the tab, and that's
   acceptable: the lock protects the flow, not the device.
2. **`skipOnGoBack` together with `preventGoBack` on the same step is an error**,
   raised when the step implementation is registered (`StepRegistry.register`),
   because the two contradict each other.
