# A 1-bit 800x2060 label that may make the printer play a tune.
#
# The printer advances one dot row at a time, so it hums at its row rate: at
# 203 dpi and 3 ips that's 609.6 Hz, about D#5 (heard as a constant drone).
# Stripes of period p rows modulate that hum at rate / p Hz, which adds
# sidebands at (drone - f) and (drone + f). The label is about 3.3 s long.
#
# Two ways to pick the stripe frequency f for a note of pitch P:
#   direct     f = P           (first attempt; the drone dominated and the tune
#                               came out squashed to 2-3 semitones)
#   sideband   f = drone - P   (aim at the lower sideband; pitch falls as f
#                               rises. Reachable only for 0 < f <= rate / 2, so
#                               P must lie between rate / 2 and the drone)
# The label is 3.3 s at 3 ips; --rows-per-second is 203 * the printer's ips.
#
#   python3 make-melody.py out.png [--mode direct|sideband] [--tonic HZ]
#                                  [--rows-per-second 609.6]
import argparse, struct, zlib

W, H = 800, 2060
MARGIN_X, MARGIN_Y = 20, 30  # black stripes span x in [MARGIN_X, W - MARGIN_X)
GAP_ROWS = 8                 # white rows between notes, so repeated notes separate

# Semitones above the tonic (C major degrees; the tune only uses C to G).
SEMITONES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7}

# Ode to Joy, first phrase: (note, beats).
TUNE = [("E", 1), ("E", 1), ("F", 1), ("G", 1), ("G", 1), ("F", 1), ("E", 1),
        ("D", 1), ("C", 1), ("C", 1), ("D", 1), ("E", 1), ("E", 1.5), ("D", 0.5),
        ("D", 2)]

ap = argparse.ArgumentParser()
ap.add_argument("out")
ap.add_argument("--rows-per-second", type=float, default=203 * 3.0)
ap.add_argument("--mode", choices=["direct", "sideband"], default="direct")
ap.add_argument("--tonic", type=float, default=None,
                help="pitch of C in Hz; default 130.81 (direct) or 329.63 (sideband)")
args = ap.parse_args()
rate = args.rows_per_second
tonic = args.tonic or (130.81 if args.mode == "direct" else 329.63)

def stripe_hz(note: str) -> float:
    pitch = tonic * 2 ** (SEMITONES[note] / 12)
    f = pitch if args.mode == "direct" else rate - pitch
    if not 0 < f <= rate / 2:
        raise SystemExit(f"note {note} ({pitch:.0f} Hz) needs stripes at {f:.0f} Hz, "
                         f"outside 0..{rate / 2:.0f}; pick another --tonic")
    return f

def row_bytes(black: bool) -> bytes:
    bits = [1] * W  # 1 = white
    if black:
        for x in range(MARGIN_X, W - MARGIN_X):
            bits[x] = 0
    out = bytearray()
    for i in range(0, W, 8):
        v = 0
        for b in bits[i:i + 8]:
            v = (v << 1) | b
        out.append(v)
    return bytes(out)

BLACK, WHITE = row_bytes(True), row_bytes(False)

usable = H - 2 * MARGIN_Y
total_beats = sum(b for _, b in TUNE)
rows_per_beat = usable / total_beats

rows = [WHITE] * MARGIN_Y
for note, beats in TUNE:
    n = round(beats * rows_per_beat)
    f = stripe_hz(note)
    phase = 0.0
    block = []
    for _ in range(n - GAP_ROWS):
        # Black for the first half of every period, white for the second; the
        # phase accumulator keeps the average period at rate / f for any f.
        block.append(BLACK if phase % 1.0 < 0.5 else WHITE)
        phase += f / rate
    rows += block + [WHITE] * GAP_ROWS
rows += [WHITE] * (H - len(rows))
rows = rows[:H]

raw = b"".join(b"\x00" + r for r in rows)  # filter type 0 on every row

def chunk(typ, data):
    c = struct.pack(">I", len(data)) + typ + data
    return c + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)

png = (b"\x89PNG\r\n\x1a\n"
       + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 1, 0, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
open(args.out, "wb").write(png)
secs = usable / rate
print(f"{len(png)} bytes; {len(TUNE)} notes over about {secs:.1f} s at {rate:g} rows/s, {args.mode}")
for n in sorted(SEMITONES, key=SEMITONES.get):
    if any(n == t for t, _ in TUNE):
        f = stripe_hz(n)
        print(f"  {n}: stripes {f:5.1f} Hz (period {rate / f:.2f} rows)")
