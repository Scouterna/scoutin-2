# A 1-bit 800x2060 test pattern (203 dpi badge): border, rulers, line-width
# ladder, checkerboard, solid areas and a circle. No text, no brand assets.
import sys, zlib, struct
W, H = 800, 2060
px = [[1] * W for _ in range(H)]  # 1 = white, 0 = black

def rect(x0, y0, x1, y1, v=0):
    for y in range(max(0, y0), min(H, y1)):
        for x in range(max(0, x0), min(W, x1)):
            px[y][x] = v

# 6-dot border, 10 dots in from the edge
m, t = 10, 6
rect(m, m, W - m, m + t); rect(m, H - m - t, W - m, H - m)
rect(m, m, m + t, H - m); rect(W - m - t, m, W - m, H - m)

# Rulers inside the border: a tick every 50 dots, longer every 100, on the left and top
for y in range(0, H, 50):
    rect(m + t + 2, y, m + t + 2 + (40 if y % 100 == 0 else 20), y + 3)
for x in range(0, W, 50):
    rect(x, m + t + 2, x + 3, m + t + 2 + (40 if x % 100 == 0 else 20))

# Corner markers: solid squares top-left and bottom-right, hollow top-right
rect(70, 70, 150, 150)
rect(W - 150, H - 150, W - 70, H - 70)
rect(W - 150, 70, W - 70, 150); rect(W - 142, 78, W - 78, 142, 1)

# Line-width ladder: horizontal black lines 1, 2, 3, 4, 6, 8 dots, gaps equal to the width
y = 220
for w in (1, 2, 3, 4, 6, 8):
    for k in range(10):
        rect(150, y, W - 150, y + w); y += 2 * w
    y += 24

# Same ladder as white lines in a black block (reverse text is where bleed shows)
rect(150, y, W - 150, y + 260)
yy = y + 20
for w in (1, 2, 3, 4, 6):
    for k in range(4):
        rect(170, yy, W - 170, yy + w, 1); yy += 2 * w
    yy += 10
y += 300

# 8-dot checkerboard (50% grey)
for cy in range(8):
    for cx in range(16):
        if (cx + cy) % 2 == 0:
            rect(150 + cx * 31, y + cy * 31, 150 + (cx + 1) * 31, y + (cy + 1) * 31)
y += 8 * 31 + 40

# Solid black bar, then a circle outline and a filled circle
rect(150, y, W - 150, y + 120); y += 160
cx, cy, r = W // 2, y + 160, 150
for yy in range(cy - r, cy + r + 1):
    for xx in range(cx - r, cx + r + 1):
        d2 = (xx - cx) ** 2 + (yy - cy) ** 2
        if (r - 8) ** 2 <= d2 <= r ** 2 or d2 <= 50 ** 2:
            px[yy][xx] = 0
y = cy + r + 40

# Diagonals in the remaining space down to the bottom corner marker
for i in range(0, 560):
    for d in range(3):
        for (xx, yy) in ((150 + i, y + i + d), (W - 150 - i, y + i + d)):
            if 0 <= yy < H - 160 and 0 <= xx < W:
                px[yy][xx] = 0

# 1-bit grayscale, MSB first, filter 0
raw = bytearray()
for row in px:
    raw.append(0)
    bits = 0; n = 0
    for v in row:
        bits = (bits << 1) | v; n += 1
        if n == 8:
            raw.append(bits); bits = 0; n = 0
def chunk(typ, data):
    c = struct.pack(">I", len(data)) + typ + data
    return c + struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff)
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 1, 0, 0, 0, 0)) \
    + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
open(sys.argv[1], "wb").write(png)
print(len(png), "bytes")
