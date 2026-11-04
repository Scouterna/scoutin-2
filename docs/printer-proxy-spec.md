# Printer relay — design spec

Target: **`printer-proxy`**, a small Go daemon that runs on a Raspberry Pi at each
check-in desk, plus the scoutin side it talks to: a first-class **printing
domain** in the backend (`packages/backend/src/domains/printing`). It holds the
`printer:print` step, print pools, a job queue, badge templates, the relay hub and
an admin UI.

This is a living design document. It records the decisions made so far and the
questions still open. Sections marked **OPEN** are unresolved and must not be
guessed at during implementation. Items marked **SPIKE** must be verified on real
hardware before the code that depends on them is written.

---

## 1. Goals

- **Kiosks never print.** A check-in produces print jobs; whether a printer is busy,
  jammed or unplugged never slows a kiosk down (unless the step is explicitly
  configured to wait, §9).
- **Unattended and resilient.** Runs for days. Survives network blips, printer
  restarts, cables being bumped and Pi reboots, and recovers by itself.
- **Never print twice, never silently lose a badge.** Every job ends in a definite
  state. Where the truth is genuinely unknowable, the job says so and a human
  decides (§6).
- **Staff can see what's going on.** Printer state (ready, out of badges, lid open,
  offline) and job outcomes are visible in admin and in metrics.
- **Simple setup.** Install on a Pi, plug in a printer, assign it to a pool in
  admin. A printer is recognized as the same printer across reboots, replugs and
  even moves to another Pi.

Non-goals: the relay knows nothing about badge design. Printers are already
configured and calibrated for the badge stock; the relay never changes printer
settings.

---

## 2. Decisions at a glance

| Topic | Decision |
| --- | --- |
| Printer | Zebra **ZD421** (203 or 300 dpi), USB, direct thermal |
| Pi ↔ printer | `/dev/usb/lpN` via the kernel `usblp` driver. Pure Go, no CUPS, no cgo |
| Printer identity | Zebra **serial number**, never the USB port or device node |
| Pi ↔ cloud | Pi dials **out** over a long-lived WebSocket, using our own protocol |
| Network | Wired Ethernet, DHCP |
| Queue ownership | **Cloud.** The DB is the single source of truth |
| Distribution | Printers **pull** one job at a time, only when idle and healthy |
| Routing | **Pools.** Kiosk → one pool. Printer → at most one pool |
| Rendering | Cloud, **at lease time**, pixel-exact for the leasing printer |
| Template format | TSX rendered via **Satori → resvg → 1-bit PNG**; files next to the config |
| Wire image | **1-bit PNG.** The relay validates, packs and sends it as ZPL `^GFA` |
| Ambiguous outcome | Job becomes **`unknown`**, is never auto-reprinted, and staff decide |
| Step behavior | `behavior: queue` (default) or `behavior: wait`. **No timeout** |
| Kiosk without a pool | Attendee sees an error screen and tells staff. No job is created |
| Pool without healthy printers | Attendee sees nothing; jobs queue and staff are alerted |
| Reprint | Admin only. Always creates a **new** job |
| Admin printing | Any template with custom values, to a pool or one specific printer. Test and calibration labels are just templates |
| Enrollment | Pi has no screen or keyboard: an unenrolled relay **shows a 4-color code on its LEDs**, and staff enter the colors in admin. Without LEDs, the colors are in the log |
| Stale jobs | Never expire. Printed FIFO when printers come back |
| Visibility | Admin dashboard, Prometheus metrics, **4 NeoPixels on the Pi in a row, one per USB port** |
| Desk switch | A GPIO switch. Closed = no new jobs start on this relay; the pool fails over |
| Install | Static arm64 binary + systemd unit, via an install script |
| Backend ownership | **First-class domain**, not a plugin. Kiosks reference pools, relays authenticate like kiosks, and the hub needs routes, a WebSocket, tables and admin pages, none of which the plugin API offers. Unused printing costs nothing: no relays paired, no traffic |

---

## 3. Architecture

```
 ┌────────┐  ws /ws/session   ┌──────────────────────────────────────┐
 │ Kiosk  │ ────────────────► │ scoutin backend                      │
 └────────┘                   │                                      │
                              │  printer:print step ─► PrintJob (DB) │
 ┌────────┐  http             │                          │           │
 │ Admin  │ ────────────────► │  Pools / Printers / Jobs │ lease     │
 └────────┘                   │                          ▼           │
                              │  Template renderer (Satori/resvg)    │
                              │                          │           │
                              │  Relay hub  ◄────────────┘           │
                              └──────▲───────────────────────────────┘
                                     │ wss /ws/print-relay (Pi dials out)
                    ┌────────────────┴────────────────┐
             ┌──────┴──────┐                   ┌──────┴──────┐
             │ Pi: relay A │                   │ Pi: relay B │
             └──┬───────┬──┘                   └──────┬──────┘
           USB  │       │ USB                    USB  │
            ┌───▼──┐ ┌──▼───┐                     ┌───▼──┐
            │ZD421 │ │ZD421 │                     │ZD421 │
            └──────┘ └──────┘                     └──────┘
```

- A **relay** is one Pi running `printer-proxy`. It has zero or more printers.
- A **printer** is identified by its serial number. It belongs to whichever relay
  currently reports it.
- A **pool** is a set of printers. Kiosks are assigned to a pool. With one printer
  per kiosk, you create one pool per kiosk.

---

## 4. Data model (Prisma, indicative)

Built in `packages/backend/prisma/schema.prisma`, which is authoritative. It
differs from the sketch below in a few places:

- `PrintJob.relayId` records the relay that holds the lease. Reconciling
  (§7.3) and a dropped connection (§13.5) go by it rather than by the
  printer's current relay, so a printer moved to another Pi mid-job can't get
  its `sending` job re-queued by a relay whose journal never saw it.
- No `PrintRelayEnrollment` table: pending enrollments live in the backend's
  memory (§12.3). A paired enrollment holds the new key until the relay
  collects it, which ends the enrollment.
- `PrintRelay.hostname` is kept from `hello`, `Printer.port` from
  `PrinterInfo`.
- No CHECK constraint for "exactly one of `poolId` / `targetPrinterId`": the
  code creating jobs enforces it, and deleting a pool sets `poolId` to null on
  its finished jobs, which a CHECK would forbid.
- Raw SQL writes timestamps in UTC (`now() AT TIME ZONE 'utc'`), like Prisma:
  the columns have no time zone.

```prisma
model PrintRelay {
  id          String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name        String                     // defaults to the Pi's hostname
  keyHash     String    @unique
  version     String?                    // relay version (tree hash, §8.10), from hello
  lastSeenAt  DateTime?
  revokedAt   DateTime?
  createdAt   DateTime  @default(now())
  printers    Printer[]
}

model PrintPool {
  id        String     @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name      String     @unique
  profile   String?               // expected printer profile (§8.9), by name
  printers  Printer[]
  kiosks    Kiosk[]
  jobs      PrintJob[]
  createdAt DateTime   @default(now())
}

model Printer {
  id           String     @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  serial       String     @unique      // Zebra serial number, the stable identity
  name         String?                 // staff-friendly label, e.g. "Desk 3 left"
  model        String?
  dpi          Int?
  widthDots    Int?                    // ^PW, as reported
  lengthDots   Int?                    // label length, as reported
  relayId      String?    @db.Uuid     // relay currently reporting it
  relay        PrintRelay? @relation(fields: [relayId], references: [id])
  poolId       String?    @db.Uuid     // null = unassigned, never leases
  pool         PrintPool? @relation(fields: [poolId], references: [id])
  state        String                  // see §8.3
  stateDetail  Json?                   // raw flags, for admin
  stateSeq     BigInt     @default(0)  // last applied status sequence number
  config       Json?                   // settings read on connect (§8.9)
  configAt     DateTime?
  lastSeenAt   DateTime?
  createdAt    DateTime   @default(now())
}

// Added to the existing Kiosk model:
//   printPoolId String?    @db.Uuid
//   printPool   PrintPool? @relation(fields: [printPoolId], references: [id])

model PrintJob {
  id             String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  // Exactly one of poolId / targetPrinterId is set (CHECK constraint). See §5.
  poolId          String?    @db.Uuid  // bound at creation
  pool            PrintPool? @relation(fields: [poolId], references: [id])
  targetPrinterId String?    @db.Uuid  // admin jobs aimed at one printer
  source          String               // step | reprint | admin
  createdById     String?    @db.Uuid  // admin user, for reprint/admin jobs
  state           String               // see §6
  template       String
  values         Json
  // Idempotency: one job per (session, step, item). See §9.2.
  idempotencyKey String?   @unique
  sessionId      String?   @db.Uuid
  kioskId        String?   @db.Uuid
  reprintOfId    String?   @db.Uuid   // set on reprints, links to the original
  printerId      String?   @db.Uuid   // set on lease
  leaseId        String?   @db.Uuid   // fresh UUID per lease
  leaseExpiresAt DateTime?
  failureReason  String?
  createdAt      DateTime  @default(now())
  leasedAt       DateTime?
  sendingAt      DateTime?
  finishedAt     DateTime?

  @@index([poolId, state, createdAt])
}
```

`PrintJob` also gets an append-only history (a `PrintJobEvent` table, or the
existing audit log) recording every transition with printer, lease and reason.
Admin needs this to answer "what happened to this badge?".

---

## 5. Pools and routing

- **Each printer is in at most one pool.** A printer with no pool is *unassigned*:
  it appears in admin with live status but never leases. New printers start out
  unassigned, so putting a printer in a pool is the single step that brings it into
  service.
- **Each kiosk is in at most one pool.**
- **A job is bound to a pool when it is created**, using the kiosk's pool at that
  moment. Reassigning a kiosk later does not move jobs that are already queued.
- **Rerouting is explicit.** Admin can move queued jobs from one pool to another, in
  bulk or one by one.
- **Moving or unassigning a printer mid-job.** The printer finishes its in-flight
  job (it drains), then stops leasing from the old pool. The lease query matches on
  the printer's *current* pool, so this needs no special handling.
- **Failover is implicit.** A printer that is out of badges, has its lid open or is
  offline simply stops asking for work, and the other printers in the pool take the
  load.
- **Kiosk without a pool.** The `printer:print` step fails before creating any jobs
  and shows the attendee a screen naming the kiosk and asking them to fetch staff.
  This is a setup error, and staff are physically present to fix it.
- **Pool without healthy printers.** This is operational, not an error. Jobs queue
  silently from the attendee's point of view. Staff get the
  *pool stalled* alert (§11).

### 5.1 Printer-targeted jobs

A job targets **either a pool or one specific printer**. Kiosk jobs always target
a pool. Admin jobs (test label, calibration label, any template with custom
values, §11.1) can target a single printer instead.

- A targeted job is leased only by that printer, **even if it's unassigned**. That
  makes it possible to print a test label on a brand-new printer before it's in
  any pool.
- A printer takes its targeted jobs **before** pool jobs, so a calibration label
  doesn't wait behind a queue of badges.
- If the target printer is offline, the job waits. Staff can cancel it.

Future option, not in scope: a pool-level *fallback pool* for setups like "my own
printer, with overflow to a shared pool".

---

## 6. Job lifecycle

### 6.1 States

```
                 cancel (admin)
   ┌──────────┐ ───────────────► canceled
   │  queued  │ ◄──────────────────────────────┐
   └────┬─────┘                                │ release / lease expiry /
        │ lease (printer pulls)                │ relay disconnect /
        ▼                                      │ "not sent" after reconnect
   ┌──────────┐ ───────────────────────────────┘
   │  leased  │
   └────┬─────┘
        │ begin (CAS, acked BEFORE any USB write)
        ▼
   ┌──────────┐ ── printer confirms ──► printed
   │ sending  │ ── definitely not sent ─► queued   (journal or release proves it)
   └────┬─────┘
        │ outcome cannot be determined
        ▼
     unknown ── staff: "mark printed" / "reprint" (new job) / "dismiss"

   failed: permanent errors only (render error, invalid image). Never retried
   automatically. Staff can reprint.
```

| State | Meaning | Bytes could have reached a printer? |
| --- | --- | --- |
| `queued` | Waiting for a printer | No |
| `leased` | Offered to one printer, not yet started | No |
| `sending` | Relay was cleared to write, and may have done so | **Yes** |
| `printed` | Printer confirmed the label came out | Yes (terminal) |
| `unknown` | Cannot tell whether it printed | Maybe (terminal until staff act) |
| `failed` | Permanent error, never sent | No (terminal) |
| `canceled` | Canceled by staff while queued | No (terminal) |

### 6.2 Invariants

1. **Only `queued` and `leased` jobs are ever re-queued automatically.** A job that
   has reached `sending` is *never* re-queued unless the relay proves it was not
   written: by its journal on reconnect (§7.3), or by releasing it after no
   `beginAck` arrived (§13.6).
2. **Every transition is a compare-and-set** on `(id, state, leaseId)`. A stale
   message from an old lease or an old connection fails the CAS and is ignored.
3. **The relay writes to USB only after the cloud has acknowledged `sending`.**
4. **One job in flight per printer.** A printer doesn't lease again until its
   current job is resolved.
5. **Reprints are new jobs** (`reprintOfId` set). A terminal job never moves back
   to a non-terminal state.
6. **Jobs never expire.** When printing resumes, they print in FIFO order
   (`createdAt`) within the pool.

---

## 7. Leasing and concurrency

### 7.1 Lease

When a printer is ready and idle, the relay sends `printer:ready`. The cloud tries
to lease the next queued job for that printer: jobs targeted at it first, then the
oldest job in its pool:

```sql
UPDATE "PrintJob" SET state = 'leased', "printerId" = $printer,
       "leaseId" = gen_random_uuid(), "leaseExpiresAt" = now() + interval '15 seconds',
       "leasedAt" = now()
WHERE id = (
  SELECT id FROM "PrintJob"
  WHERE state = 'queued'
    AND ("targetPrinterId" = $printer OR "poolId" = $pool)  -- $pool may be NULL
  ORDER BY ("targetPrinterId" IS NULL), "createdAt"
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```

Prisma can't express this, so it goes through `$queryRaw`. `SKIP LOCKED` keeps it
correct with any number of printers and backend instances.

If no job is available, the cloud records the printer as **waiting**. When a job
is created or re-queued in that pool, the hub offers it to a waiting printer
immediately. With a single backend instance this is in-memory; running several
instances later would need Postgres `LISTEN/NOTIFY` (out of scope).

The leased job is rendered for that printer (§10) and sent as `job:offer`.

### 7.2 Begin handshake

1. Relay validates the image (§8.4). If it's invalid, the relay sends
   `job:result failed` and the job is never written.
2. Relay checks the printer is still healthy. If not, it sends `job:release`, the
   job goes back to `queued`, and the printer stops pulling until it is healthy.
3. Relay sends `job:begin {jobId, leaseId}`.
4. Cloud: `UPDATE … SET state='sending' WHERE id=$job AND state='leased' AND "leaseId"=$lease`.
   It replies `job:beginAck {ok}`.
5. **Only if `ok`**: the relay writes the journal intent (fsync), then writes to USB.

A lease that is never begun expires after 15 s and the job goes back to `queued`.
Expiry can only touch `leased` jobs, so it can never cause a duplicate.

### 7.3 Journal (on the Pi)

One small file per printer in `/var/lib/printer-proxy/journal/<serial>.json`, written
atomically (write temp file, fsync, rename, fsync directory):

```json
{ "jobId": "…", "leaseId": "…", "phase": "intent", "counterBefore": 18234 }
{ "jobId": "…", "leaseId": "…", "phase": "result", "outcome": "printed" }
```

- **`intent`** is written *after* `beginAck` and *before* the USB write.
- **`result`** is written when the outcome is known, and kept until the cloud acks
  `job:result`. Results are delivered at least once, and the cloud handles
  duplicates idempotently via the CAS.
- The file is deleted after `resultAck`.

On (re)connect, the relay includes its journal in `hello`. The cloud reconciles
every job it has in `sending` for that relay's printers:

| Cloud state | Relay journal | Resolution |
| --- | --- | --- |
| `sending` | no entry for the job | Never written, so back to `queued` |
| `sending` | `result` | Apply the result |
| `sending` | `intent` | Resolve via the label counter (§7.4), else `unknown` |

### 7.4 Resolving "intent but no result" with the label counter

The ZD421 keeps a persistent label counter, **`odometer.total_label_count`**
(SGD). The relay reads it
just before writing (stored as `counterBefore` in the journal intent) and again
when it recovers:

- **Counter increased** and the printer buffer is empty: `printed`.
- **Counter unchanged** and the buffer is empty: not printed, so back to `queued`.
- **Counter unavailable** (printer gone, unreadable): `unknown`.

This turns most crashes, cable bumps and relay restarts into definite outcomes.
What remains `unknown` is chiefly "the printer itself disappeared and didn't come
back".

Verified on a ZD421 (2026-10-23): `total_label_count` goes up by exactly one per
printed badge and **does not change on a manual feed**. `user_label_count` behaves
the same but is user-resettable, so it isn't used. `media_marker_count` counts black
marks passing the sensor and also moves on feeds. Not yet checked: whether media
calibration (`~JC`) bumps `total_label_count`. It doesn't need to be: calibration
can't overlap a job. Manual calibration is an admin action that only runs while the
printer is idle, and automatic calibration on lid close or power-up is disabled by
the profile (`ezpl.head_close_action` / `ezpl.power_up_action` = `no motion`,
§8.9).

**Buffered jobs and `unknown`.** A job that's held in the printer's buffer (lid
open, media out) prints when the problem is fixed. If such a job is declared
`unknown` and staff reprint it, the original could print as well. So whenever the
relay declares a job `unknown` while it can still reach the printer, it first sends
`~JA` (cancel all buffered formats). An `unknown` job then cannot print later.

### 7.5 Other races and how they're handled

| Race | Handling |
| --- | --- |
| Two printers lease the same job | `FOR UPDATE SKIP LOCKED` (§7.1) |
| Lease expires while the relay is slow | Expiry only touches `leased`; `begin` CAS fails, so the relay drops the job |
| `beginAck` lost | No ack means no write. After 10 s the relay releases the job, and the server re-queues it from `sending` (§13.6) |
| Zombie connection (half-open TCP) | New connection gets a new epoch and supersedes the old one. Ops carry `leaseId`. Ping/pong timeouts clean up |
| Printer fails between health check and write | Job stays `sending`. Printer buffers it and prints when fixed (§8.5) |
| USB re-enumerates mid-job (`lp0` → `lp1`) | Tracked by serial. Recovery via the counter (§7.4) |
| Admin cancels a job just as it's leased | Cancel is a CAS on `queued` only. On `leased`, the next `begin` fails |
| Out-of-order status messages | Per-printer `seq`. The cloud keeps only the highest |
| Same printer reported by two relays | Most recent `hello` wins. In-flight results still apply via `leaseId` |
| Step runs twice (retry, reconnect) | Idempotency key (§9.2) |

---

## 8. The relay (`printer-proxy/`)

### 8.1 Layout

```
printer-proxy/
  cmd/printer-proxy/    the daemon: discovery, LEDs, switch; cloud and local job sources
  cmd/fakecloud/        stand-in for the server's relay hub, for testing end to end
  cmd/{svgprint,ledtest,switchtest,statuslog}/   hardware test tools
  internal/cloud/       WebSocket client, reconnect/backoff, protocol types; fakecloud/
  internal/config/      config.yaml
  internal/desk/        printer states and pairing codes → LED frames
  internal/enroll/      pairing with the server (§12)
  internal/hw/          NeoPixels (SPI), desk switch (GPIO), USB port map
  internal/journal/     atomic per-printer journal
  internal/printer/     USB discovery, status polling, per-printer worker, actions
  internal/sdnotify/    systemd ready and watchdog
  internal/zebra/       device I/O, ~HS/~HQES parsing, SGD getvar/setvar
  internal/zpl/         PNG validation, ^GFA encoder with ZPL compression
  deploy/               install.sh, systemd unit, udev and polkit rules, drop-ins
  dist.sh               builds the release bundle
```

Static build: `CGO_ENABLED=0 GOOS=linux GOARCH=arm64`.

**Target hardware: Raspberry Pi 3B+** running Raspberry Pi OS Lite **64-bit**. Other
models should work, but only the 3B+ is tested and has a built-in USB port map.

Required `/boot/firmware/config.txt` lines (the install script adds them):

```ini
dtparam=spi=on
# On a Pi 3 the SPI clock is derived from the core clock, which scales with load
# and would corrupt NeoPixel timing. Pin it.
core_freq=250
core_freq_min=250
```

3B+ notes:

- Ethernet and all four USB ports share one USB 2.0 bus through the onboard
  LAN7515 hub/NIC. Badge traffic is tiny, so this doesn't matter for throughput,
  but the ports sit at two levels of hub (relevant for the port map, §8.6).
- The Zebra has its own power supply, so the 3B+'s 1.2 A total USB current limit
  doesn't come into play. Use the official 2.5 A PSU; the NeoPixels are fed from
  the 5 V rail.
- The journal (§7.3) relies on fsync to the SD card surviving a power cut. Use a
  decent SD card and the default ext4. A read-only root (overlayfs) is **not**
  compatible unless `/var/lib/printer-proxy` is on a separate writable partition,
  because the key and journal must persist.

### 8.2 Discovery

- Scan `/sys/class/usbmisc/lp*` every 2 s. For each device, walk up to the USB
  device and read `idVendor` (Zebra: `0a5f`), `idProduct` and `serial`.
- The USB serial descriptor **is** the printer serial: verified on the ZD421
  (`usb.device.serial_string` = sysfs `serial`). No query is needed to identify a
  printer.
- Read-back works: SGD `! U1 getvar "…"` written to `/dev/usb/lpN` is answered on
  the same device node (verified, 2026-10-22). The reply is a bare quoted string
  with no STX/ETX framing and no terminator (`"350"`). An unknown variable is
  answered with `"?"`.
- A device that appears starts a worker for that printer. A device that disappears
  marks the printer `offline`; if it had a job in `sending`, the job goes to recovery
  (§7.4).
- The relay remembers which printer was last seen on which port (in memory, plus a
  small file so it survives a restart). A port whose printer **disappeared** shows
  `offline` (red, fast blink) rather than "nothing plugged in" (off). This matters
  because a ZD421 that loses power stays off (see §8.9), and that has to be visible
  at the desk. The red blink clears when the same printer (by serial) shows up on
  any port, so moving a printer just works, when another printer takes the port, or
  when staff **switch the desk switch to pause** (closing it clears every
  `offline` port, for printers removed on purpose; switching back to print
  doesn't clear anything).

### 8.3 Status

The ZD421 doesn't push status over USB, so the relay polls. `~` commands are
handled immediately by the printer, ahead of anything buffered, so polling during
a print is safe.

- `~HQES`: error and warning bitmasks (media out, head open, paused, over temp, …).
- `~HS`: paused, head up, paper out, **formats in buffer**, **labels remaining**,
  label length.
- Printer properties (dpi, `^PW` width, model, firmware) are read once on connect
  via SGD.

Observed on the ZD421 (2026-10-22, `cmd/statuslog`):

- **Every fault also pauses the printer.** Lid open sets `~HS` head-up and
  pause plus `~HQES` head open. `~HQES` error bit `0x10000` (not in Zebra's table)
  follows the pause state exactly, so it's treated as "paused", not an error.
- **Media out is only detected when the printer moves media** (feed or print).
  An empty printer reports `ready` while idle. So the first job sent to it is how
  the relay finds out (see §8.5 for the re-queue).
- After a plain lid close the printer stays paused until someone resumes it.
  After reloading media it resumed by itself within about 0.3 s.
- **The `~HS` and `~HQES` replies are a moment apart** and can briefly disagree.
  A state change only counts once two consecutive polls agree.
- `/dev/usb/lpN` **can only be opened by one process at a time** (`EBUSY`). While
  the relay runs, it owns the printer; manual `cat file > /dev/usb/lp0` won't work.
- "Labels remaining" is the count left **in the current job**, not the stock
  left. The printer can't sense remaining stock.
- **Unplug and power-off are detected instantly**: the blocked read on
  `/dev/usb/lpN` fails with `EIO`. The device node disappears 0.3–2 s later.
- **On (re)appearance, the node briefly exists before udev grants the `lp`
  group access** (`EACCES` for about 0.3 s). After power-on, USB enumerates before
  the firmware answers, so the first query can time out. A newly appeared
  printer is therefore `connecting` for up to ~10 s, during which `EACCES` and
  missed replies aren't errors.
- After a power cycle the printer comes back `ready` (not paused), with its
  buffer empty. Anything that was held in it is gone (recovery: §7.4).

Polling interval: **2 s when idle, 250–500 ms while a job is in flight.** No
reply within a timeout means the printer is `unresponsive`. Every query flashes
the printer's data light, so idle polling is kept slow: a constantly blinking
light would hide real incoming jobs from staff. Unplug and power-off don't depend
on polling (the blocked read fails at once). When a poll shows a different
state, the relay re-polls after 300 ms to confirm it (two agreeing polls),
so an idle fault shows within about 2.5 s, not 4 s.

Derived state reported to the cloud:

| State | Leases? |
| --- | --- |
| `connecting` (just appeared, ≤ ~10 s, see above) | No |
| `ready` | Yes |
| `printing` | No (one job in flight) |
| `inhibited` (desk switch closed, §8.6) | No |
| `paused` | No |
| `media_out` | No |
| `head_open` | No |
| `error` (other `~HQES` error; detail attached) | No |
| `unresponsive` | No |
| `offline` (USB gone) | No |

`~HQES` warnings (e.g. clean head) are reported but don't block leasing.

**SPIKE:** how `usblp` read-back behaves (blocking, partial reads, timeouts).
Expect a dedicated reader goroutine per printer, with request/response matched on
the STX/ETX framing.

### 8.4 Printing

1. Decode the PNG with `image/png`. Accept only 1-bit grayscale or 2-color
   paletted images whose width is ≤ the printer's `widthDots` and whose size matches
   the dimensions in the offer. Anything else results in `failed: invalid_image`,
   and nothing is written.
2. Pack rows MSB-first, **inverting polarity** (in PNG gray 0 = black; in ZPL a
   set bit = a black dot).
3. Emit `^XA^FO0,0^GFA,{total},{total},{bytesPerRow},{data}^FS^XZ`, with ZPL
   ASCII compression (repeat counts, `,`/`!` row fills, `:` row repeat). This
   makes solid black and white areas cheap over USB. The format carries **no
   setting commands** (`^PW`, `^LL`, `^PR`, darkness…). The printer's own
   configuration applies, and profiles manage it (§8.9).
4. Write in a single `write()` and record when it completed.

### 8.5 Completion

After the write, poll fast until **formats in buffer = 0 and labels remaining = 0
with no `~HQES` error**. Then the job is `printed`.

- If an error appears (lid open, media out), the job **stays `sending`**. The printer
  holds the format and prints it once the problem is fixed, and the relay keeps
  watching. The printer's state is reported, so the pool and admin see it.
- **Media out before the label started:** if the printer goes `media_out` while
  the job is still buffered **and the label counter (§7.4) hasn't moved**, nothing
  was printed. The relay cancels it on the printer (`~JA`), reports `not_sent`, and
  the cloud re-queues it, so another printer in the pool takes it instead of the
  badge waiting for a reload. If the counter moved, the label was partly printed:
  `~JA`, then `unknown` for staff.
- If the printer disappears, go to recovery (§7.4).

Measured on a ZD421 (2026-10-23, 800×2060 badge, 3 ips, `printer-proxy print`):

| Step | Time |
| --- | --- |
| Job received → bytes written (decode, encode, health poll, counter read) | 357 ms |
| `write()` of 47.5 KB (206,000 raw bytes, ASCII-compressed) | 2 ms |
| Write → format seen in the printer's buffer | 190 ms |
| Write → printed (counter +1, buffer empty) | 4.28 s |

The 4.28 s is almost all print time: 2108 dots at 203 dpi is 10.4 in, or 3.46 s at
3 ips. Of the 357 ms before the write, ~240 ms was image decoding (benchmarked on
the Pi). A fast path for paletted and grayscale images cut that to ~57 ms
(`go test -bench . ./internal/zpl`). The rest is the health poll and the counter
read (~110 ms).

**To investigate (2026-10-23):** one job went from created to `printed` in 1.68 s,
against about 3.5 s of physical printing. It happened while printer 4 was
misbehaving: the stock rolled back out through the rollers, which was traced to
one damaged label. The likely explanation is that the label advanced less than a
full badge before the counter moved, not that "printed" fires early in normal
operation. Not yet confirmed: rerun with `-debug`, whose per-poll `job poll` lines
show formats, labels remaining and the counter over time.

**SPIKE:** check the delay between the buffer draining and the label physically
exiting, and whether opening the head *mid*-print reprints, skips or truncates the
label.

### 8.6 Desk hardware: LEDs and switch

Both are optional. A relay with neither works fine; it just loses local feedback,
and its pairing colors are only in the log (§12).

#### NeoPixels (4 × WS2812/SK6812)

- **One LED per physical USB port**, mounted as a **row, LED 1–4 from left to
  right**, separate from the ports themselves (labeled on the case). LED n shows
  port n.
- **Driven over SPI** (`/dev/spidev0.0`, MOSI = GPIO10), with each WS2812 bit sent
  as **4 SPI bits at 3.2 MHz** (0 → `1000`, 1 → `1100`), giving about 312 ns and
  625 ns high times, within spec for old and new WS2812B revisions. The 3-bit
  encoding at 2.4 MHz you often see gives about 424 ns for a 0 on a Pi 3, because
  the SPI clock gets rounded down, and that's above newer chips' limit. Then a
  ≥330 µs low reset. Verified on the 3B+ with `cmd/ledtest`. Pure Go, no root (the
  `spi` group is enough), and it works on Pi 3/4/5. The usual `rpi_ws281x` library
  needs cgo and root (DMA/PWM) and doesn't support the Pi 5.
- **Color pipeline:** palette color → gamma 2.8 per channel → brightness cap
  (default 0.2) → GRB. Gamma makes mixed colors (amber) and fades look right;
  pure colors aren't affected by it.
- **Electrical:** 5 V supply (pins 2/4, GND pin 6). Data on pin 19, **no level
  shifter**: 3.3 V data to 5 V WS2812s is marginal, but usually fine with a short
  wire and a 300–500 Ω series resistor at the first LED. If the LEDs flicker or show
  wrong colors, power the **first** LED through a diode (1N4148/1N400x, about
  4.3 V). That lowers its logic-high threshold below 3.3 V, and it re-drives a full
  signal to the rest. Brightness is capped in software; 4 LEDs at the cap draw well
  within what the Pi's 5 V pin can supply.

**USB port map.** The physical port a printer is in is used **only** for the LEDs;
printer identity is still the serial number. The kernel's USB path for a device
maps to an LED index through a per-model table (`internal/hw/ports.go`). Ports are
numbered by column, seen from the USB side, and port *n* uses LED *n* (counted
along the data chain):

```
1 3
2 4
```

Measured on the **3B+** (built in):

| Port | Position | USB path |
| --- | --- | --- |
| 1 | top left | `1-1.1.2` |
| 2 | bottom left | `1-1.1.3` |
| 3 | top right | `1-1.3` |
| 4 | bottom right | `1-1.2` |

The left pair sits behind the second-level hub inside the LAN7515 (`1-1.1.1` is the
onboard Ethernet). A printer behind an external hub shows on the LED of the port
the hub is in (longest-prefix match). Other models can override the table in
config. `printer-proxy ports` prints the live mapping, so a new board can be
checked by plugging a printer into each port.

**Palette**, tuned by eye on the actual LEDs at brightness 0.2 / gamma 2.8. Values
are palette inputs, before gamma and brightness. Re-tune if the LED model,
brightness or gamma changes.

| Name | Value | Status |
| --- | --- | --- |
| green | `00ff40` | tuned. Pure `00ff00` looks yellowish when dimmed on these LEDs (the LED's own tint, not a signal fault: `000000` is fully dark) |
| amber | `ff8000` | provisional |
| red | `ff0000` | provisional |
| magenta | `ff00ff` | provisional |
| white | `ffffff` | provisional |
| blue | `0000ff` | provisional |

**Per-port states.** Two rules: *color* says what kind of thing (green = fine,
amber = stopped on purpose, red = go to the printer, magenta = look in admin,
white = needs setup); *pattern* says whether anyone must act (steady = no,
blinking = yes, fast = broken). Every red state blinks, so red and green are
never both steady (red/green color blindness).

| Port state | LED |
| --- | --- |
| Nothing plugged in | off |
| `ready`, in a pool | green, steady |
| `printing` | green, slow breathe |
| Unassigned (no pool) | white, steady |
| `inhibited` | amber, steady |
| `paused` | amber, slow blink |
| `media_out` / `head_open` | red, slow blink |
| `error` / `unresponsive` | red, fast blink |
| Has an `unknown` job awaiting staff | magenta, slow blink |

**Whole-relay overlays** take over all four LEDs:

| Relay state | LEDs |
| --- | --- |
| Booting / connecting | blue chase |
| Cloud disconnected | all blue, slow breathe (nothing can print without the cloud) |
| Pairing | the 4-color code (§12), with a short all-off blink every 3 s marking it as a code |
| Just paired | all green flash for 3 s |

#### Desk switch

- A GPIO input, default **GPIO22 (physical pin 15) to GND (pin 14)**. No external
  power or resistor; the relay enables the internal pull-up (~50 kΩ) itself when
  it opens the pin. It's read through the GPIO character device (`/dev/gpiochip*`)
  in pure Go, with a 50 ms debounce. GPIO22 is pulled *down* at boot by default, so
  it reads as "inhibit" until the relay starts; that's harmless, since nothing
  prints before then. Never connect 5 V to a GPIO.
- **Fails open, by design.** The switch is wired so that only a *closed* circuit
  blocks. A broken wire, a missing switch or a loose connector reads as open
  (pull-up), and printing continues. A hardware fault must never stop badges.
  Don't invert this.
- **Closed = inhibit.** No new job starts on *any* printer on this relay:
  - The relay stops sending `printer:ready`.
  - A `leased` job that hasn't begun is released back to the queue.
  - A job already `sending` **finishes**. The bytes are already in the printer,
    and canceling would only create `unknown` jobs.
- Every printer reports `inhibited`, so other printers in the pool take the load and
  admin shows "paused at the desk".
- Opening the switch resumes immediately.
- Typical uses: reloading badge stock, clearing a jam, or "stop printing here while
  we sort something out".

### 8.7 Configuration and files

`/etc/printer-proxy/config.yaml`:

```yaml
server: https://scoutin.example.se
```

That's the only required setting, so every Pi can use the identical image.
Optional settings, with defaults:

```yaml
autoUpdate: true           # install the relay version the server expects (§8.10); off for a dev build
leds:
  enabled: true
  spi: /dev/spidev0.0
  brightness: 0.2          # status colors; a pairing code always shows at full brightness
  # portMap: { "1-1.1.2": 0, "1-1.1.3": 1, "1-1.3": 2, "1-1.2": 3 }   # overrides the Pi 3B+ map
switch:
  enabled: true
  gpio: 22    # physical pin 15, switch to GND on pin 14
```

- Keys are checked strictly: a misspelled key is an error, not ignored.
  `printer-proxy check-config [path]` validates a file without starting.
- Flags (`-server`, `-brightness`, …) override the file when given explicitly,
  for testing. `-config` names another file; without it, a missing default file
  just means "no settings" (local-only mode).
- The number of LEDs follows the port map.

Files:

- `/var/lib/printer-proxy/key`: relay key (mode 0600)
- `/var/lib/printer-proxy/enrollment.json`: pending enrollment, if not yet paired
- `/var/lib/printer-proxy/journal/`: per-printer journals
- `/var/lib/printer-proxy/lock`: held (flock) by the running daemon, so a second
  copy refuses to start rather than fighting over the printers, LEDs and journal

### 8.8 Deployment

**Release bundle.** `printer-proxy/dist.sh` builds
`printer-proxy-<version>-linux-arm64.tar.gz` (plus a `.sha256`): the static binary
with the version stamped in, `install.sh`, the systemd unit, udev and polkit
rules, the low-write drop-ins and an example config. The version is the git
tree hash of `printer-proxy/` (§8.10). For now the bundle reaches a Pi by `scp`;
§8.10 plans automatic updates.

**`sudo ./install.sh --server <url>`** (first install) or **`sudo ./install.sh`**
(update, keeps the config). Safe to re-run; it never reboots by itself and says
when a reboot is needed. It:

- creates the `printer-proxy` system user;
- copies the whole bundle to `/opt/printer-proxy/versions/<version>/` and points
  the symlink `/opt/printer-proxy/current` at it (an atomic switch). The newest
  three versions are kept for rolling back. `/usr/local/bin/printer-proxy` links to the
  current one, for `version`, `check-config` and `print`;
- writes or updates `/etc/printer-proxy/config.yaml` and checks it before
  restarting;
- installs `printer-proxy.service`, the udev rule and the polkit rule, then
  enables and restarts the service;
- sets up the low-write OS (below) and the boot config for the LEDs (§8.1:
  `dtparam=spi=on`, plus the pinned core clock on a Pi 3 only);
- warns if the hostname is still `raspberrypi`: admin shows it while pairing, so
  every Pi needs its own.

**Service** (`printer-proxy.service`):

- `Type=notify`: the relay reports ready once started, and pings the watchdog
  from its discovery loop every second. `WatchdogSec=30`, `Restart=always`.
- Runs as `printer-proxy` with supplementary groups `lp` (printers), `spi`
  (LEDs) and `gpio` (desk switch). systemd creates `/var/lib/printer-proxy`
  (0700) and `/run/printer-proxy` (local print socket).
- Hardened: `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`,
  `PrivateTmp`, no kernel tunables or modules, network and unix sockets only.
- Logs go to journald (`journalctl -u printer-proxy`), without the relay's own
  timestamps.

**udev rule:** keeps Zebra printers' USB power permanently on (no autosuspend),
independent of driver defaults:

```
ACTION=="add", SUBSYSTEM=="usb", ATTR{idVendor}=="0a5f", TEST=="power/control", ATTR{power/control}="on"
```

**Pulling the plug is safe.** At an event, people unplug Pis rather than shut
them down, so the design doesn't depend on a clean shutdown. The relay's own
state is crash-safe by construction (atomic, fsynced writes, §7.3). The risk is
the SD card losing data when power drops mid-write, so `install.sh` keeps the OS
from writing:

- journald logs in RAM only (`Storage=volatile`, 32 MB). Lost on reboot; the
  server keeps each relay's status and results;
- swap in compressed RAM only (`rpi-swap` `Mechanism=zram`). The default also
  writes idle pages to `/var/swap` on the card;
- no automatic package updates or man-db rebuilds in the background
  (`apt-daily`, `apt-daily-upgrade`, `man-db` timers disabled). A Pi shouldn't
  update itself mid-event anyway;
- `/tmp` in RAM and `noatime` on the root filesystem are already the default on
  Raspberry Pi OS (trixie).

That leaves a few small, crash-safe files per badge. Use high-endurance SD cards
and a proper power supply: an undervolted Pi corrupts writes more easily than a
pulled plug. If corruption still shows up in practice, the next step is a
read-only root (overlayfs) with the relay's state on a separate writable
partition.

**Remote reboot and power-off** (`relay:action`, §13.4): admin can reboot a relay,
for example to apply an update (§8.10), or power it off. A polkit rule lets the
`printer-proxy` user reboot and power off the Pi, and nothing else. Before
powering off, the relay sets all LEDs to **steady blue** (reads as lavender, used
for nothing else; provisional, not yet checked by eye). The strip stays powered
after the Pi halts and keeps showing it, which tells staff it's safe to unplug. A
powered-off Pi can only be started again at the desk, so admin should confirm,
and power off one relay at a time. Badges in flight are safe: the printer prints
what it holds, and the journal settles it on the next start.

### 8.9 Printer configuration and profiles

The relay **never changes printer settings on its own**. Configuration is read
automatically and applied only when staff ask for it.

**On every connect** (after `connecting`, before the printer may lease):

1. **Read the configuration** via SGD `getvar` and report it to the cloud
   (`printer:config`): model, firmware, dpi, print width (`^PW`), label length,
   media type, sensor type, darkness, print speed, print method, Energy Star.
   The dpi, width and length are what rendering uses (§10.3).
2. **Clear leftovers**, but only once the journal is settled. If the journal has
   an entry for this printer, resolve it first (label counter, §7.4). Then send
   `~JA` so anything still buffered (from before a relay restart or cable bump)
   can't print later. Every session starts with an empty printer.

**Profiles** are the expected settings for a kind of badge stock, kept as config
next to the templates and versioned in git:

```yaml
# config/printerProfiles.yml
# Values captured from the tuned ZD421 (2026-10-20 config dump).
badge-fanfold:
  ezpl.media_type: mark             # fanfold with black mark
  media.sense_mode: bar
  media.type: label
  ezpl.print_method: direct thermal
  ezpl.print_width: "800"           # dots; the badge is 800 wide
  zpl.label_length: "2108"          # dots
  print.tone: "15.0"                # darkness, 0.0-30.0
  media.speed: "3.0"                # ips, 2.0-6.0; 3 chosen by test print (2026-10-23)
  power.energy_star.enable: "off"
  # No automatic calibration: a self-calibration while a badge is held in the
  # buffer (e.g. reloading after media out) would bump the label counter and
  # make an unprinted badge look printed (§7.4).
  ezpl.head_close_action: no motion
  ezpl.power_up_action: no motion
  ezpl.tear_off: "34"               # tear-off position fine-tune, dots; from the tuned printer
  # USB is the only interface. The others are off so nothing else can send
  # jobs or change settings, and so an unused wired port doesn't show a red
  # LED (seen on a printer straight out of the box, 2026-10-23).
  internal_wired.enable: "off"
  wlan.enable: "off"
  bluetooth.enable: "off"
  usb.mirror.auto: "off"            # no automatic firmware/config update from a USB stick
  device.languages: epl_zpl         # the factory default
```

Network, Bluetooth and language changes only take effect after a printer restart
(`! U1 do "device.reset" ""`), so applying a profile ends with one when any of them
changed. The restart is soft (the printer comes back by itself), and with
`ezpl.power_up_action: no motion` it doesn't feed. `ezpl.tear_off` is assumed to be
the same for every printer of a model, so it's part of the profile. If badges
stop at visibly different tear-off positions on two printers, that assumption is
wrong and it has to move to per-printer settings.

`head.resolution.in_dpi` (203) is reported but not part of a profile: it's a
hardware property, so a mismatch means the wrong printer model, not a setting to
apply.

- A pool names its profile (`PrintPool.profile`). Admin compares each printer's
  reported config to its pool's profile and shows **deviations**, for example a
  replacement printer straight out of the box, or a 300 dpi printer in a 203 dpi
  pool. A deviation is a warning in admin, not a printer state: the printer
  keeps printing.
- **Apply profile** is an explicit admin action on one printer (or all
  deviating printers in a pool). The relay sends the `setvar`s, reads every value
  back, and reports per-setting success. Read-only settings (like
  `power.power_on_mode`, below) are reported as not applied, not retried.
- It only runs while the printer is idle (`ready`, `paused`, `media_out` or
  `head_open`), never mid-job. The relay holds off leasing until it's done.

**Maintenance actions** from admin, all one-off and on demand:

The settings read on every connect (`printer:config`):

- identity and hardware: `device.product_name`, `appl.name` (firmware),
  `head.resolution.in_dpi`, `power.power_on_mode`;
- rendering: `ezpl.print_width`, `zpl.label_length`;
- media and print: `ezpl.media_type`, `media.sense_mode`, `media.type`,
  `ezpl.print_method`, `ezpl.print_mode`, `media.backfeed`, `ezpl.tear_off`,
  `print.tone`, `media.speed`, `power.energy_star.enable`,
  `ezpl.head_close_action`, `ezpl.power_up_action`;
- interfaces: `internal_wired.enable`, `wlan.enable`, `bluetooth.enable`,
  `usb.mirror.auto`, `device.languages`.

A profile may name other settings too. They're applied and read back the same
way, and reported after the apply.

Values are compared as the printer reports them, trimmed, case-insensitively,
and numerically where both parse as numbers (`15` = `15.0`).

| Action | What the relay does |
| --- | --- |
| Apply profile | `getvar` each setting; `setvar` only those that differ; read back; report; restart the printer (after reporting) if a network, Bluetooth or language setting changed |
| Calibrate media | `~JC`, then wait at least 3 s and until 3 polls in a row agree on a non-printing state (max 60 s). **SPIKE:** how status looks during calibration. On 2026-10-23 a `~JC` left `odometer.total_label_count` **and** `media_marker_count` unchanged |
| Cancel buffer | `~JA` |
| Test label / calibration label | ordinary targeted jobs (§5.1) |

Baseline for the ZD421s at this event (the first profile):

| Setting | Value | Why |
| --- | --- | --- |
| `power.energy_star.enable` | `off` | No low-power idle mode, so the first badge after a quiet spell isn't delayed |
| Media, darkness, speed | as tuned for the badge stock | Captured from the tuned printer into the profile |

Known limitation: **`power.power_on_mode` is `manual` and read-only on the
ZD421** (a `setvar` to `auto` is ignored). After a power cut the printer stays off
until someone presses its power button. Mitigations: the port LED shows `offline`
(§8.2), admin alerts on printers that disappeared, and printers should be on a
reliable power strip.

### 8.10 Versions and automatic updates

The updater and the CI job are built; the server endpoint isn't yet.
`fakecloud -bundle <file>` stands in for both.

- **A relay version is a content hash, not a number:** the git tree hash of
  `printer-proxy/` (`git rev-parse HEAD:printer-proxy`). It covers the code,
  `go.mod` (which pins the Go version) and `deploy/`, and changes only when one
  of them does, whatever happens in the rest of the repo. So a new server
  release with an unchanged relay means no download and no restart on the Pis.
  `dist.sh` computes it from the working tree, so uncommitted changes count as
  if committed. Admin shows it shortened; versions have no order, and nothing
  needs one: the server names exactly the one it wants.
- **CI builds each version once.** The `relay` job in `build-image.yml` runs on
  every push, ahead of the image build (`needs: relay`), so no server goes live
  expecting a bundle that doesn't exist yet. It computes the tree hash. If the
  GitHub Release `printer-proxy/<hash>` already has the bundle's `.sha256`, it
  stops there; otherwise it tests, runs `dist.sh` and publishes that release
  (`--latest=false`, so "Latest release" stays the app's) with the bundle, then
  the `.sha256` last, which marks it complete. Builds aren't byte-reproducible
  (tar timestamps), which is fine: each version is built once, and the checksum
  always comes from the release.
- **The server decides the version.** The Docker build gets the tree hash and
  the bundle's checksum as build args, set in the image as
  `PRINT_RELAY_VERSION` and `PRINT_RELAY_SHA256`. A public, unauthenticated endpoint, e.g.
  `GET /api/print-relays/version` → `{ version, url, sha256 }` (`sha256` is the
  bundle's checksum, for checking the download). Public so it also works before
  pairing. The relay protocol and the backend change together, so the server
  expecting the relay it was built with keeps them compatible, and rolling back
  the server rolls back the relays.
- **`printer-proxy update` runs before every start of the relay**, as root
  (`ExecStartPre=-+`), so the relay can't replace its own binary. A Go
  subcommand rather than a shell script: downloading, checking and safely
  unpacking are easier to get right and to test in Go. It:
  1. asks the server (10 s timeout). A 404 or 204 means "no version named":
     nothing to do. A version must be a plain name (it becomes a directory),
     the URL http(s) and the checksum 64 hex digits;
  2. stops if the version is `current`'s. That's one request and no restart;
  3. if the version is one of the kept ones (§8.8), runs its `install.sh`: a
     rollback, with no download;
  4. otherwise downloads the bundle from the URL the server gave (the public
     GitHub Release `printer-proxy/<version>` of `Scouterna/scoutin-2`; 60 s
     timeout, 64 MB cap) into `/opt/printer-proxy/.update-*`, checks the SHA-256,
     unpacks it (only plain files and directories, all inside the one top-level
     directory), checks its `VERSION` and runs its `install.sh --no-restart`.
     That installs the deploy files too, not only the binary. systemd then
     starts the new `current`. A changed unit file applies from the next start.

  A signature with a public key installed by `install.sh` would be stronger
  than a checksum from the server; later.
- **It never blocks printing.** If the server or GitHub is unreachable, or
  anything fails, it logs why, and systemd starts the binary that's already
  there (the `-` in `ExecStartPre=-+`). `TimeoutStartSec=120` leaves room for
  the timeouts. `autoUpdate: false` in the config turns it off, for a Pi
  running a development build.
- **Triggering it (not built yet):** today a relay updates on its next
  restart; the server only logs a relay running another version. Planned: the
  relay sends its version (the tree hash) in `hello`. If the server wants
  another, it refuses the connection with an "upgrade required" reason; the relay
  exits, systemd restarts it, and the updater runs. A `relay:action reboot` does
  the same.

---

## 9. The `printer:print` step

A built-in step, registered by the backend's printing domain. Rendering happens
at lease time in the hub (§10.3), so the step only creates the job and waits.

```yaml
- uses: printer:print
  with:
    template: badge
    # One job is created per item, with the item as the template's values.
    values: ${{ session.subjects }}
    # queue (default): continue once all jobs are durably queued.
    # wait: continue only after every job has reached a terminal state
    #       (printed, failed, unknown or canceled).
    behavior: queue
```

`behavior` is declared like any step option, as `"behavior?": "'queue' | 'wait'"`
in the step's `inputs` schema. `wait` is shorthand for "wait for the printing to
finish", not for the queue.

### 9.1 Behavior

- **Kiosk has no pool:** show the "kiosk not connected to a printer" error screen.
  No jobs are created.
- **`behavior: queue`:** create the jobs in one transaction, then `setCompleted()`.
  This is effectively instant and doesn't depend on any printer.
- **`behavior: wait`:** create the jobs, then show a "printing" screen with progress
  ("2 of 5"). The step completes when every job is terminal:
  - all `printed`: a success screen, or just continue
  - any `failed`, `unknown` or `canceled`: a friendly "please ask staff at the
    desk" hand-off, then continue
  - **There is no timeout.** While waiting, the step **locks navigation**, and staff
    free a stuck kiosk with the admin abort. See
    [step-navigation-spec.md](step-navigation-spec.md) §3 and §5.
- **`printer:print` is a barrier** (`preventGoBack: true`). Once its jobs exist, nobody
  can go back past it, so there's no "cancel jobs on go-back" case. `undoCheckin`
  leaves print jobs alone. See [step-navigation-spec.md](step-navigation-spec.md) §2.

### 9.2 Idempotency

`idempotencyKey = sessionId + ":" + stepIdInFlow + ":" + index`. If `onStepStart`
runs again (kiosk reconnect, `restartStep`), the existing jobs are found and reused,
and in `behavior: wait` mode the step resumes waiting on them. A step running twice
must never produce two badges.

### 9.3 Completing from outside a request — SPIKE

Steps currently complete from within a WebSocket message handler
(`ctx.setCompleted()`). `behavior: wait` has to complete when a *job* changes state,
which happens outside any kiosk request. To verify:

- whether a step context can be obtained for a session from a job event (via the
  session registry), or whether the step should be woken by sending the kiosk a
  message that it answers with `step:callMethod`
- what happens if the kiosk is disconnected when the jobs finish (on reconnect,
  `onStepStart` runs again, finds the jobs all terminal, and completes)

---

## 10. Templates and rendering

### 10.1 Files

```
config/templates/
  badge.tsx
  fonts/…
  images/…
```

A template is a TSX module. Its default export is a function returning JSX, and it
also exports an ArkType schema for its values:

```tsx
export const values = type({ firstName: "string", "groupName?": "string" });

export default function badge(values: typeof values.infer, label: Label, printer: PrinterContext) {
  return (
    <div style={{ width: label.width, height: label.height, display: "flex", flexDirection: "column" }}>
      <FitText width={label.width - label.mm(6)} max={label.pt(40)} min={label.pt(14)}>
        {values.firstName}
      </FitText>
      <Img src="images/logo.png" width={label.mm(20)} dither />
    </div>
  );
}
```

`Label` exposes `width`/`height` in dots, `dpi`, and `mm()`/`pt()` helpers that
convert to dots. Rendering happens per printer (§10.3), so the same template is
pixel-exact on 203 and 300 dpi printers.

The `values` schema is used in three places:

- **Job creation** validates the values. A step whose values don't match fails
  immediately with a config error, instead of failing later at render time.
- **Admin printing** (§11.1) generates a form from the schema.
- **Admin preview** renders a PNG for a chosen printer or dpi before printing.

Templates also receive a read-only `printer` context (name, serial, pool, dpi,
relay) for labels that describe the printer itself.

### 10.1.1 Built-in labels

- **Test label** (`_test`): built in (code only), so it works with no config. Its values are `{}`. It shows the
  printer's name, serial, pool, relay and dpi, with a border at the label edge.
  Used to tell which physical printer is which.
- **Calibration label** (`calibration`): a **static image template** (see below).
  Admin shows a one-click button for it on each printer when it exists.

#### Static image templates

A template can also be a plain PNG instead of TSX, with one file per dpi:
`calibration@203.png`, `calibration@300.png`. It's printed exactly as it is: no
values, no scaling, placed top-left and padded to the label size. If no file exists
for a printer's dpi, the job fails with `render_error`. This keeps the relay rule
"only 1-bit images, never raw ZPL" intact. The existing raw-ZPL calibration label
gets converted to PNG once, e.g. via Labelary or by printing and scanning it.

### 10.2 Helpers

- **`<FitText>`** measures text with `opentype.js`, using the same font buffers
  Satori uses (glyph advances plus kerning; opentype.js can't read the GSUB table
  of some fonts, so ligatures are ignored, which the 0.98 factor absorbs), and
  picks `size = min(max, ref × width / measured(ref)) × 0.98`. At `min`, it wraps
  to `lineClamp` lines and then ellipsises, using Satori's `lineClamp` and
  `textOverflow` (checked 2026-10-24: it wraps and ends in "…").
- **`<Img dither>`** resizes the image with `sharp` to its exact pixel size and
  Floyd–Steinberg dithers it to pure black and white *before* embedding, placed at
  integer pixel coordinates. Without `dither`, the image is thresholded. `<Img>` is
  only a marker in the tree; the renderer resolves it to a real `<img>` before
  Satori runs.

### 10.3 Pipeline

`template(values, label)` → Satori → SVG → resvg at native size → grayscale →
**threshold at 80 of 255** → 1-bit PNG. Below the midpoint on purpose: thermal dot
gain spreads the printer's black, so 80 keeps small white-on-black text legible
(found by test prints on a ZD421: 128 loses it, 64 warps round letters).

Text and vectors come out crisp. Pre-dithered images survive thresholding because
their pixels are already pure black or white.

Rendering happens **at lease time**, for the leasing printer's dpi, width and label
length. Reprints therefore use the current template, and a pool can mix 203 and
300 dpi printers. Renders are cached in memory, keyed by
`(jobId, dpi, widthDots, lengthDots, templateHash)`. A render error is permanent:
the job becomes `failed: render_error` and the error appears in admin.

The image is the **full label** (width = `^PW`, height = label length), so there's
no ambiguity about where on the stock it lands.

Design note for template authors: large solid black areas are the hardest thing
for a thermal printer (heat, banding, head wear). Test them at the configured speed
and darkness.

### 10.4 Loading

How config is loaded in production today: the backend runs TypeScript source
directly (`node --conditions production src/index.ts`, Node 24 type stripping).
`config/` is excluded from the image by `.dockerignore` and mounted at runtime.
Step config is read lazily and cached until restart
(`step.service.ts`, `getStepConfig`).

Consequences for templates:

- Node's type stripping doesn't transform JSX, so `.tsx` can't be imported
  directly, in dev or in prod.
- Templates live in the runtime-mounted config directory (possibly read-only),
  so they can't be compiled at image build time.

**Decision: compile at runtime with jiti.**

- `jiti@2` is already in the production dependency tree (via Prisma's `c12`).
  Promote it to a direct dependency of the backend.
- `jiti.import("config/templates/<name>.tsx")` transpiles TSX on import. Imports
  resolve normally from the file's location, so `/app/config/templates` finds
  `/app/node_modules`, and templates can share local helper files.
- JSX is compiled to our own `h` function, which produces the plain element
  objects Satori takes. There's no React dependency.
- jiti's filesystem and module caches are disabled (`fsCache: false`,
  `moduleCache: false`), since the config mount may be read-only. JSX uses
  `{ runtime: "automatic", importSource: "@scouterna/scoutin-print-templates" }`,
  so a file needs no pragma. Babel refuses a classic `@jsx h` pragma under the
  automatic runtime, so a file with one is loaded by a second jiti instance
  configured for the classic runtime (`pragma: "h"`, `pragmaFrag: "Fragment"`).
- Template helpers (`FitText`, `Img`, `Label`, `h`) come from a package
  (`@scouterna/scoutin-print-templates`, a workspace package), not relative paths,
  so templates get types in the editor.

Rejected: esbuild (a new native dependency, plus a temp-file bundling and
`nodePaths` workaround, for a speed gain that doesn't matter at this scale), and
JSX-free templates (no compile step, but much worse to write).

**Load and validate everything at startup and fail fast.** Compile every template,
check each `values` schema, and check that static PNG templates (§10.1.1) parse as
1-bit PNGs. Checking that every `printer:print` step references a template that exists comes
with that step. A broken template stops the deploy, not the
first attendee's badge.

When a printer of a new dpi connects and a static template has no file for that
dpi, the problem is logged and shown in admin immediately, rather than when the
first job fails.

**Changing templates means restarting**, the same as step config today. A
"reload templates" admin action can be added later if editing during an event
turns out to matter.

---

## 11. Admin and observability

### 11.1 Admin UI

- **Relays:** list, connection state, version, last seen. **Pair** (enter the colors
  the relay shows), rename, revoke.
- **Printers:** live state and detail, relay, pool assignment, name. Reported
  configuration with **deviations from the pool's profile** highlighted. Actions
  (§8.9): **apply profile**, **calibrate media**, **cancel buffer**, and one-click
  **test label** and **calibration label**, targeted at that printer (§5.1).
- **Print:** pick any template, fill in values via a form generated from the
  template's schema (with a raw JSON fallback), preview it, and send it to a pool
  or a specific printer, with a number of copies. Admin jobs are tagged
  `source: admin` with the user who created them, and appear in job history like
  any other job.
- **Pools:** CRUD, member printers and kiosks, queue depth, healthy-printer count.
  A prominent **stalled** banner when a pool has queued jobs and no healthy printers.
- **Jobs:** filter by state, pool, kiosk or session. Cancel queued jobs. Move
  queued jobs to another pool. Reprint (choosing the pool). Resolve `unknown` jobs
  with *mark printed* / *reprint* / *dismiss*. Show the full history of each job.

### 11.2 Metrics (existing `/metrics`)

| Metric | Type | Labels |
| --- | --- | --- |
| `print_relay_connected` | gauge | relay |
| `printer_state` | gauge (1 for the current state) | printer, pool, state |
| `print_pool_queue_depth` | gauge | pool |
| `print_pool_healthy_printers` | gauge | pool |
| `print_jobs_total` | counter | pool, outcome |
| `print_job_duration_seconds` | histogram (queued → printed) | pool |

Key alert: `print_pool_queue_depth > 0 and print_pool_healthy_printers == 0` for 1
minute. Also alert on any `unknown` job and on any disconnected relay.

---

## 12. Enrollment: a color code on the LEDs

The Pi has no screen or keyboard in normal operation. An unenrolled relay shows a
4-color code on its LEDs, and staff enter those colors in admin. The only thing
configured on the Pi is the server URL.

### 12.1 Flow

1. **Start without a key.** The relay calls `POST /api/print-relays/enroll` and
   stores the reply in `/var/lib/printer-proxy/enrollment.json` (0600), so a
   restart shows the same code.
2. **Show the code.** The four LEDs show the colors in order, LED 1 → 4, left to
   right (§8.6). They're steady, with a short all-off blink every 3 s, so a code
   can't be mistaken for printer states. The palette is the five colors that
   read clearly on the desk LEDs (checked by eye, 2026-10-23): **red, green,
   yellow, white, pink**. Blue reads as lavender and cyan as white, so neither is
   used. The code is shown at **full brightness**: at the normal status
   brightness (0.2) the colors wash out. That gives 5⁴ = 625 codes, and the
   server never hands out a combination already held by another pending
   enrollment. The colors are also logged, for anyone with SSH access. A relay
   without LEDs is paired from the log. There is no typed code: pairing is
   always by colors.
3. **Staff pair it.** In admin, staff choose *Pair relay* and click the four
   colors in order (swatches in a row, like the LEDs). They give the relay a name. Before confirming, admin shows the hostname,
   IP and printer serials of the matching enrollment.
4. **Collect the key.** The relay polls every 5 s. Once paired, it receives a
   long-lived key, stores it in `/var/lib/printer-proxy/key` (0600, written
   atomically), deletes the enrollment file, turns the LEDs back to printer
   states and connects to `/ws/print-relay`.

### 12.2 HTTP contract

| Request | Reply |
| --- | --- |
| `POST /api/print-relays/enroll` `{ hostname, printers: PrinterInfo[] }` | `201 { enrollmentId, secret, colors: string[4] }`. `429` when rate-limited |
| `GET /api/print-relays/enroll/:id`, `Authorization: Bearer <secret>` | `200 { status: "pending" }` or `200 { status: "paired", key }`. `404` unknown or expired; `401` wrong secret |

- `PrinterInfo` is the same type as in §13.3. `printers` may be empty: a relay can
  be paired before any printer is plugged in.
- Once `paired` has been returned, the enrollment is done and further polls get
  `404`.
- The relay treats `404` and `401` alike: it deletes its enrollment and starts
  over with a new code. Any other failure (network, `5xx`) just means polling on.
  A failing `POST` is retried with backoff (2 s → 60 s, jittered).

### 12.3 Lifetime and revocation

- **The server never reveals a code.** No API, admin page or log on the server
  shows the colors of a pending enrollment. The only way to learn a code is to
  look at the Pi's LEDs or its own log. Admin finds an enrollment
  only by its code, and shows its hostname, IP and printers only after a match,
  for confirmation. A list of pending enrollments, if any, carries no codes (it's
  for spotting a flood, not for picking one). Otherwise the code would no longer
  prove physical presence, and pairing would become "approve from a pending list"
  (rejected below).
- **Expiry:** a pending enrollment lives while the relay keeps polling and is
  dropped 5 minutes after the last poll. The relay polls every 5 s, so the
  TTL only has to bridge a Pi reboot or a short network drop (the relay keeps
  its enrollment on disk and shows the same colors after a restart). An
  abandoned enrollment doesn't hold its colors and pending slot any longer than
  that.
- **In memory, not in the database.** Pending enrollments are short-lived and
  there's one backend instance. A server restart forgets them: the relay's next
  poll gets `404` and it starts over with new colors. Restarting in the few
  seconds between staff pairing a relay and the relay collecting its key leaves
  an unused relay row (the relay enrolls again and is paired anew); staff
  revoke it.
- **Revocation:** a revoked key gets a `401` on the WebSocket upgrade. The relay
  deletes the key and starts over at step 1, showing a new code. A revoked Pi can
  be re-paired without touching it.
- **Abuse:** `/api/print-relays/enroll` is unauthenticated, so it's rate-limited
  per IP, with a cap on pending enrollments. The cap also stops anyone exhausting
  the 625 color codes. A fake enrollment is harmless: it can only be approved by
  someone entering *its* code, which is only shown on the attacker's own hardware.
  The color code's low entropy is fine for the same reason: nobody can guess
  their way in, because the admin is the one entering it.

**How many colors are enough.** The code doesn't need to be hard to guess,
because the admin enters the code shown on the Pi. It only needs to be unique
among pending enrollments, and to make a misread unlikely to match a different
pending enrollment (roughly pending / codes). With a cap of 10–20 pending, 625
codes is plenty. Fewer, unmistakable colors beat more, similar ones: a misread
color is the realistic mistake. Optionally, the server can also avoid handing out
a code that differs by one LED from a pending one.

Why this rather than alternatives:

- *Setup code entered at install* (mirroring kiosk setup) means typing on the Pi or
  preparing every SD card separately, and the 15-minute expiry doesn't suit Pis
  prepared days before an event.
- *Approve from a pending list* with no code works, but staff can't reliably tell
  which pending Pi is which, and anyone on the network could get a device into the
  list. The code proves physical presence at the desk.
- *A printed pairing label* as a fallback for Pis without LEDs was dropped
  (2026-10-23): every desk has LEDs, and the relay doesn't report whether it has
  them. The log covers the rare case.

---

## 13. Wire protocol (`/ws/print-relay`)

This is the contract between deployed Pis and the server, so changes to it must
stay backward compatible or be coordinated with a relay release.

### 13.1 Connection

- **Endpoint:** `<server>/ws/print-relay`. The relay always dials out.
- **Auth:** `Authorization: Bearer <relayKey>` on the upgrade request. `401` means
  the key is rejected: the relay deletes it and starts enrollment over (§12).
- **Framing:** JSON text frames in the existing envelope
  `{ name: string; data?: unknown }`. Images are base64 inside the JSON; at
  5–20 KB per badge, binary frames aren't worth the complexity. The relay accepts
  messages up to 4 MB.
- **Liveness:** the relay sends a WebSocket ping every 10 s and drops the
  connection after 30 s without a pong. It reconnects with exponential backoff and
  full jitter (1 s → 30 s cap), resetting after a connection that stayed up.

### 13.2 Session order

```
relay  → hello            printers + journal
server → welcome          only after reconciling this relay's in-flight jobs
relay  → printer:status   for every printer
relay  → job:result       for every result not yet acked
relay  → printer:ready    for every idle, ready printer
... then anything, in any order
```

The relay sends nothing but `hello` until `welcome`, so the server reconciles
before any new lease.

### 13.3 Relay → server

| Name | Data | Notes |
| --- | --- | --- |
| `hello` | `{ version, hostname, printers: PrinterInfo[], journal: JournalEntry[] }` | First message on every connection |
| `printer:attached` | `PrinterInfo` | Hotplug: a printer appeared |
| `printer:detached` | `{ serial }` | Its worker ended (unplugged, powered off) |
| `printer:status` | `{ serial, seq, state, detail?, dpi?, widthDots?, lengthDots? }` | On change, and for every printer every 30 s |
| `printer:ready` | `{ serial }` | "Give me a job". At most once per idle period |
| `job:begin` | `{ jobId, leaseId }` | Asks permission to write. Nothing is written without `ok` |
| `job:release` | `{ jobId, leaseId, reason }` | Not written: back to the queue. Sent for an offer it can't start, or after `job:begin` got no ack (§13.6) |
| `job:result` | `{ jobId, leaseId, outcome, reason?, counterBefore?, counterAfter? }` | Resent until acked |
| `printer:config` | `{ serial, settings: Record<string, string> }` | On every connect, after applying a profile, and again after every `welcome` |
| `printer:actionResult` | `{ actionId, serial, ok, results?: Record<string, { applied, value }>, restart?, error? }` | Outcome of a maintenance action |
| `relay:actionResult` | `{ actionId, ok, error? }` | Outcome of a `relay:action`. `ok: true` is sent just before the relay reboots or powers off; a second result with `error` follows if that then fails |

Types:

- `PrinterInfo = { serial, product?, port? }`. `port` is the 1-based desk port, or
  absent if unknown.
- `JournalEntry = { serial, jobId, leaseId, phase: "intent" | "result", counterBefore, outcome? }`
  (§7.3).
- `state` is one of `connecting`, `ready`, `printing`, `inhibited`, `paused`,
  `media_out`, `head_open`, `error`, `unresponsive`, `offline` (§8.3).
  `inhibited` is a ready printer whose desk switch is on pause.
- `seq` is a millisecond timestamp, strictly increasing per printer, so it keeps
  increasing across relay restarts. The server keeps the highest.
- `outcome` is `printed`, `not_sent`, `unknown` or `failed` (§6.1).
- `reason` and `detail` are free text for logs and admin, not for parsing.
- `dpi` and `lengthDots` come from the printer's settings, so they're absent
  until the first `printer:config`.
- `settings` holds the values the relay reads on every connect (§8.9), plus every
  key of the profile after an `applyProfile`. Values are as the printer reports
  them, trimmed. A setting the printer doesn't have is left out.
- In `printer:actionResult`, `ok` is false if the action failed or any setting
  wasn't applied (including read-only ones). `restart: true` means the printer is
  restarting to apply a setting: it goes offline briefly, then reconnects and
  sends a fresh `printer:config`.

### 13.4 Server → relay

| Name | Data | Notes |
| --- | --- | --- |
| `welcome` | `{ relayId, epoch }` | Reconciliation done; the relay may start |
| `job:offer` | `{ jobId, leaseId, serial, png, widthDots, heightDots }` | A lease. Only in reply to `printer:ready`, possibly much later |
| `job:beginAck` | `{ jobId, leaseId, ok }` | Write only if `ok` |
| `job:resultAck` | `{ jobId, leaseId }` | The relay may clear its journal |
| `printer:action` | `{ actionId, serial, kind: "applyProfile" \| "calibrate" \| "cancelBuffer", settings? }` | Maintenance action (§8.9). `settings` is the profile for `applyProfile` |
| `relay:action` | `{ actionId, kind: "reboot" \| "poweroff" }` | Reboot or power off the Pi (§8.8). Runs even with badges in flight; the journal settles them on the next start |

`png` must be a 1-bit grayscale or 2-color paletted PNG of exactly
`widthDots` × `heightDots`, no wider than the printer. Anything else is
`job:result failed` (`invalid_image`), never written.

Test and calibration labels are ordinary targeted jobs (§5.1), so they need no
special message. Enrollment (§12) is plain HTTP and happens before a WebSocket
connection exists.

### 13.5 What the server must guarantee

1. **Every transition is a compare-and-set** on `(jobId, leaseId, state)`. A
   message carrying an old `leaseId` changes nothing.
2. **`job:begin` is idempotent.** `leased` with this lease → `sending`, `ok: true`.
   Already `sending` with this lease → `ok: true`. Anything else → `ok: false`.
3. **`job:resultAck` is always sent**, even for a stale or duplicate result. It
   only means "you may forget this".
4. **`not_sent` re-queues.** `printed`, `unknown` and `failed` are terminal.
5. **A dropped connection** re-queues that relay's `leased` jobs. `sending` jobs
   stay `sending`. An unbegun lease expires after 15 s.
6. **Reconcile on `hello`**, before `welcome`, for every `sending` job on the
   relay's printers (§7.3): no journal entry for that lease → re-queue; `result` →
   apply it; `intent` → leave it `sending`, and the relay sends `job:result` once
   it has settled it from the label counter.
7. **Any status other than `ready` withdraws a pending `printer:ready`.** The relay
   sends `printer:ready` again when the printer is idle and ready.
8. **An action may be refused** with an immediate `printer:actionResult`
   (`ok: false`): printer not attached, busy with a job or another action, or not
   idle within 3 s. While an action runs, the printer takes no job.
9. **An offer may be released**, in `leased` or `sending`, if the lease matches.
   The relay releases a job it can't start (printer busy, no longer ready, desk
   switch on pause, or not taken by the printer within 3 s), and one whose
   `job:begin` got no `beginAck` within 10 s (§13.6). A release always means
   nothing was written, so the server re-queues the job.
10. **Every handler is idempotent.** A repeated message with the same `leaseId` gets
   the same answer.

### 13.6 A lost `beginAck`

If no `beginAck` arrives within 10 s, the relay doesn't write and sends
`job:release` (reason `no beginAck`). The server may already have the job in
`sending`, so it accepts the release there too, if the lease matches, and
re-queues the job. That's safe: the relay never writes without an ack, so a
release is proof that nothing was written. Without it, the badge would be stuck
in `sending` until the relay's next reconnect (decided 2026-10-24).

Messages on one connection arrive in order, so the server always sees the
`job:begin` before the release. If the connection itself drops while the relay
waits, no release can be sent; the reconnect's journal check (§7.3) covers that
case as before.

---

## 14. Open questions

1. **Values shape.** Templates receive `session.subjects` items. Do they need more
   context (event name, actor, session language)?

---

## 15. Spikes (do first)

1. **ZD421 status over USB (Go):** open `/dev/usb/lpN`; poll `~HS` / `~HQES`; log
   changes while opening the lid, pulling the media, pausing, and unplugging or
   replugging. Confirm the USB serial matches the printer serial. Find the label
   odometer and check it increments per label. Measure completion timing. Check
   behavior when the head is opened mid-print.
2. **Render pipeline:** Satori → resvg → 1-bit PNG for a real badge at 203 and 300
   dpi. Check `FitText` accuracy, `lineClamp`, and dithered logo quality. Print
   through the spike-1 encoder.
3. **Step engine:** completing a step from a non-request event, and re-entering a
   waiting step on kiosk reconnect (§9.3).
4. **Desk hardware (3B+):** drive 4 NeoPixels over SPI from pure Go with the core
   clock pinned (check timing under CPU load, and whether a level shifter is needed
   with your LEDs). Read
   the switch through gpiochip. Build the USB path → physical port table by
   plugging into each port.

---

## 16. Out of scope (for now)

- Multiple backend instances (would need `LISTEN/NOTIFY` for waiting printers)
- Network-attached printers (the transport should stay behind an interface so this
  can be added)
- Fallback pools, job priorities, job expiry
- Retrying the print step after staff assign a pool to a kiosk that had none
- Printing anything other than full-label 1-bit images
