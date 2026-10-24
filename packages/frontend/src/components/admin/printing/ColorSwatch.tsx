import Box from "@mui/material/Box";
import type { ReactNode } from "react";
import type { PairingColor } from "./RelayApi";

// The RGB values of the pairing colors on the desk LEDs, from
// printer-proxy/internal/desk/leds.go (pairingColors). Keyed by PairingColor so
// a color the backend adds fails to compile here until it has a swatch.
export const PAIRING_RGB = {
  red: [255, 0, 0],
  green: [0, 255, 0],
  yellow: [255, 255, 0],
  white: [255, 255, 255],
  pink: [255, 0, 255],
} satisfies Record<PairingColor, [number, number, number]>;

type Props = {
  /** The LED color, or null for an empty slot (drawn as a dashed circle). */
  color: PairingColor | null;
  size?: number;
  /** Shown centered inside an empty slot, e.g. its number. */
  children?: ReactNode;
};

/** One LED of a pairing code, drawn in its hardware color. */
export function ColorSwatch({ color, size = 48, children }: Props) {
  const rgb = color ? PAIRING_RGB[color] : null;
  const [r, g, b] = rgb ?? [0, 0, 0];

  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "text.secondary",
        ...(rgb
          ? {
              bgcolor: `rgb(${r}, ${g}, ${b})`,
              // A dark outline keeps white (and yellow) visible on light backgrounds.
              border: 2,
              borderColor: "rgba(0, 0, 0, 0.45)",
              boxShadow: `0 0 12px rgba(${r}, ${g}, ${b}, 0.6)`,
            }
          : {
              border: 2,
              borderStyle: "dashed",
              borderColor: "divider",
            }),
      }}
    >
      {children}
    </Box>
  );
}
