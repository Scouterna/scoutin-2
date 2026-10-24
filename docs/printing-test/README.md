# Printing test files

- `test-badge-800x2060.png`: a 1-bit test pattern in the badge size (800×2060
  dots, 203 dpi). Border and rulers, orientation markers, a black and a
  white-on-black line-width ladder (1 to 8 dots), a checkerboard, solid areas
  and a circle. No text, fonts or brand material. Use it for **Test print** in
  admin (Printing → Jobs), or with `printer-proxy print`.
- `make-test-badge.py`: regenerates it. `python3 make-test-badge.py out.png`
  (standard library only).
- `melody-ode-to-joy.png`, `melody-ode-to-joy-sideband.png`: experiments in
  making the printer play a tune. The printer hums at its row rate (609.6 Hz
  at 203 dpi and 3 ips, about D#5: a constant drone), and stripes of period p
  rows modulate that at 609.6 / p Hz. The first file puts the stripe frequency
  at the note's pitch ("direct"); the drone dominated and the tune sounded
  squashed to 3-4 semitones. The second aims at the lower sideband (stripe
  frequency = drone - pitch), so the pitch falls as the stripes get finer; the
  tune is in E major to fit the reachable range (about 306 to 610 Hz). Whether
  that is what the ear hears is what printing it will tell. The label is only
  about 3.3 s long at 3 ips.
- `make-melody.py`: regenerates them. `python3 make-melody.py out.png
  [--mode direct|sideband] [--tonic HZ] [--rows-per-second 609.6]`. If your
  printer's speed differs, pass 203 x its speed in ips.
- `tone-scale.png`, `make-tone-scale.py`: measures what the printer actually
  plays for a given stripe frequency. Twelve blocks of 0.25 s: all white (the
  printer's own hum), solid black, then stripes at 300, 260, 220, 190, 160, 130,
  100, 75, 50 and 30 Hz. Write down the note heard for each block, in order.
