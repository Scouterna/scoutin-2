import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import type { Guides } from "./studioStorage";
import { isPixelated } from "./studioZoom";
import type { PreviewState } from "./usePreviewRender";

const GUIDE_MARGIN = "#e91e63";
const GUIDE_CENTER = "#1e88e5";

export const LABEL_HEIGHT = 48;

function formatPercent(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** One rendered bitmap at the shared zoom, with its guides and (when comparing) label. */
export function StudioPane({
  label,
  preview,
  scale,
  dims,
  dpi,
  guides,
  dimmed,
  showLabel,
  onDims,
}: {
  label: string;
  preview: PreviewState;
  scale: number;
  dims: { width: number; height: number };
  dpi: number;
  guides: Guides;
  dimmed: boolean;
  showLabel: boolean;
  onDims: (dims: { width: number; height: number }) => void;
}) {
  const width = dims.width * scale;
  const height = dims.height * scale;
  const marginPx = (guides.marginMm / 25.4) * dpi * scale;
  return (
    <Box sx={{ flex: "0 0 auto" }}>
      {showLabel && (
        <Box sx={{ height: LABEL_HEIGHT, width, overflow: "hidden" }}>
          <Typography variant="subtitle2" noWrap title={label}>
            {label}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {preview.error
              ? "Failed"
              : [
                  preview.ms !== null && `${preview.ms} ms`,
                  preview.blackPercent !== null &&
                    `${formatPercent(preview.blackPercent)} % black`,
                ]
                  .filter(Boolean)
                  .join(" · ") || " "}
          </Typography>
        </Box>
      )}
      <Box
        sx={{
          position: "relative",
          width,
          height,
          bgcolor: "#fff",
          boxShadow: 3,
          opacity: dimmed || preview.loading ? 0.5 : 1,
          transition: "opacity 150ms",
        }}
      >
        {preview.url && (
          <Box
            component="img"
            src={preview.url}
            alt={`Preview: ${label}`}
            onLoad={(e) =>
              onDims({
                width: e.currentTarget.naturalWidth,
                height: e.currentTarget.naturalHeight,
              })
            }
            sx={{
              display: "block",
              width: "100%",
              height: "100%",
              imageRendering: isPixelated(scale) ? "pixelated" : "auto",
            }}
          />
        )}
        {guides.margin && (
          <Box
            sx={{
              position: "absolute",
              inset: marginPx,
              border: `1px dashed ${GUIDE_MARGIN}`,
              pointerEvents: "none",
            }}
          />
        )}
        {guides.centerV && (
          <Box
            sx={{
              position: "absolute",
              left: "50%",
              top: 0,
              bottom: 0,
              borderLeft: `1px solid ${GUIDE_CENTER}`,
              pointerEvents: "none",
            }}
          />
        )}
        {guides.centerH && (
          <Box
            sx={{
              position: "absolute",
              top: "50%",
              left: 0,
              right: 0,
              borderTop: `1px solid ${GUIDE_CENTER}`,
              pointerEvents: "none",
            }}
          />
        )}
        {preview.loading && (
          <CircularProgress
            size={20}
            sx={{ position: "absolute", top: 8, right: 8 }}
          />
        )}
        {preview.error && (
          <Typography
            variant="caption"
            color="error"
            sx={{
              position: "absolute",
              left: 8,
              right: 8,
              bottom: 8,
              bgcolor: "background.paper",
              p: 0.5,
            }}
          >
            {preview.error}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
