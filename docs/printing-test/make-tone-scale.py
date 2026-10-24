# A 1-bit 800x2060 label that measures how stripe frequency maps to the pitch
# the printer makes. It is a row of equal-length blocks, separated by white
# gaps: first all-white rows (the printer's own hum, no stripes), then solid
# black, then stripes at falling frequencies. Listen while it prints and write
# down the note you hear for each block, in order.
#
#   python3 make-tone-scale.py out.png [--rows-per-second 609.6]
import argparse, struct, zlib

W, H = 800, 2060
MARGIN_X, MARGIN_Y = 20, 30
GAP_ROWS = 12

# Block contents: "white", "black", or stripe frequency in Hz.
BLOCKS = ["white", "black", 300, 260, 220, 190, 160, 130, 100, 75, 50, 30]

ap = argparse.ArgumentParser()
ap.add_argument("out")
ap.add_argument("--rows-per-second", type=float, default=203 * 3.0)
args = ap.parse_args()
rate = args.rows_per_second

def row_bytes(black: bool) -> bytes:
    bits = [1] * W
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

per_block = (H - 2 * MARGIN_Y) // len(BLOCKS)
rows = [WHITE] * MARGIN_Y
for b in BLOCKS:
    n = per_block - GAP_ROWS
    if b == "white":
        block = [WHITE] * n
    elif b == "black":
        block = [BLACK] * n
    else:
        phase, block = 0.0, []
        for _ in range(n):
            block.append(BLACK if phase % 1.0 < 0.5 else WHITE)
            phase += b / rate
    rows += block + [WHITE] * GAP_ROWS
rows += [WHITE] * (H - len(rows))

raw = b"".join(b"\x00" + r for r in rows[:H])

def chunk(typ, data):
    c = struct.pack(">I", len(data)) + typ + data
    return c + struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)

png = (b"\x89PNG\r\n\x1a\n"
       + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 1, 0, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
open(args.out, "wb").write(png)
print(f"{len(png)} bytes; {len(BLOCKS)} blocks of {(per_block - GAP_ROWS) / rate:.2f} s "
      f"(+{GAP_ROWS / rate:.2f} s gap) at {rate:g} rows/s")
for i, b in enumerate(BLOCKS, 1):
    print(f"  {i:2d}: {b if isinstance(b, str) else f'{b} Hz stripes (period {rate / b:.2f} rows)'}")
