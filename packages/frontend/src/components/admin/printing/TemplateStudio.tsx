import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/api";
import {
  PrintConfirmDialog,
  PrintTargetFields,
  usePrintTargets,
} from "./PrintDialog";
import { LABEL_HEIGHT, StudioPane } from "./StudioPane";
import {
  clampMargin,
  loadPrefs,
  loadSets,
  MAX_MARGIN_MM,
  removeSet,
  savePrefs,
  saveSets,
  upsertSet,
  type ValueSet,
  withSample,
} from "./studioStorage";
import {
  clampPercent,
  MAX_PERCENT,
  MIN_PERCENT,
  scaleToPercent,
  wheelZoomPercent,
  type ZoomMode,
  zoomScale,
} from "./studioZoom";
import { TemplateValuesForm, useTemplateValues } from "./TemplateValues";
import {
  applyTemplateSize,
  describeTemplateSize,
  type FitResult,
  fitsPrinter,
} from "./templateSize";
import { usePreviewRender } from "./usePreviewRender";

type StudioStatus = InferResponseType<
  typeof api.admin.printing.dev.status.$get,
  200
>;

const CUSTOM = "custom";

const FIT_LABELS: Record<FitResult, string> = {
  fits: "fits",
  "too-small": "too small",
  unknown: "size not reported",
};
const CURRENT = "__current";
const MAX_COMPARE = 3;
const POLL_MS = 600;
const STATUS_KEY = ["admin", "printing", "dev-status"];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

const checkerSx = {
  backgroundColor: "#cfd2d6",
  backgroundImage:
    "conic-gradient(#e6e8eb 25%, transparent 0 50%, #e6e8eb 0 75%, transparent 0)",
  backgroundSize: "24px 24px",
} as const;

export function TemplateStudio() {
  const queryClient = useQueryClient();
  const [initialPrefs] = useState(() => loadPrefs());
  const [templateName, setTemplateName] = useState(initialPrefs.template);
  const [sizeKey, setSizeKey] = useState(initialPrefs.size.key);
  const [custom, setCustom] = useState({
    dpi: initialPrefs.size.dpi,
    widthDots: initialPrefs.size.widthDots,
    lengthDots: initialPrefs.size.lengthDots,
  });
  const [zoom, setZoom] = useState<ZoomMode>(initialPrefs.zoom);
  const [guides, setGuides] = useState(initialPrefs.guides);

  // ── Template status, polled: a changed revision means the files changed ──
  const statusQuery = useQuery({
    queryKey: STATUS_KEY,
    queryFn: async (): Promise<StudioStatus> => {
      const res = await api.admin.printing.dev.status.$get();
      if (res.status === 404) {
        throw new Error("The backend is not running in development mode.");
      }
      if (!res.ok) throw new Error("Could not fetch the template status");
      return (await res.json()) as StudioStatus;
    },
    refetchInterval: POLL_MS,
    retry: false,
  });
  const status = statusQuery.data;
  const revision = status?.revision ?? 0;
  // The built-in "png" template has no values or look to author.
  const templates = (status?.templates ?? []).filter(
    (t) => t.kind !== "builtin",
  );
  const template = templates.find((t) => t.name === templateName);

  const reloadMutation = useMutation({
    mutationFn: async () => {
      const res = await api.admin.printing.dev.reload.$post();
      if (!res.ok) throw new Error("Could not reload the templates");
      return (await res.json()) as StudioStatus;
    },
    onSuccess: (next) => queryClient.setQueryData(STATUS_KEY, next),
    onError: (err) => toast.error(err.message),
  });

  // ── Values and value sets ──
  const valueState = useTemplateValues(template);
  const [stored, setStored] = useState<ValueSet[]>([]);
  const [activeSet, setActiveSet] = useState("");
  const [saveName, setSaveName] = useState<string | null>(null);
  const sets = withSample(template?.sample, stored);

  // Start fresh whenever another template becomes the current one.
  const initializedFor = useRef("");
  useEffect(() => {
    if (!template || initializedFor.current === template.name) return;
    initializedFor.current = template.name;
    const own = loadSets(template.name);
    setStored(own);
    valueState.reset(template);
    const first = withSample(template.sample, own)[0];
    if (first) valueState.load(first.values, template);
    setActiveSet(first?.name ?? "");
  });

  // First load: nothing remembered, or the remembered template is gone.
  useEffect(() => {
    if (!status || template) return;
    const first = templates[0];
    if (first) setTemplateName(first.name);
  }, [status, template, templates]);

  function chooseSet(name: string) {
    setActiveSet(name);
    const set = sets.find((s) => s.name === name);
    if (set) valueState.load(set.values);
  }

  function persistSets(next: ValueSet[]) {
    setStored(next);
    if (template && !saveSets(template.name, next)) {
      toast.error("Could not save the value set in the browser");
    }
  }

  function commitSave() {
    if (saveName === null || !valueState.valid) return;
    const result = upsertSet(sets, saveName, valueState.values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    persistSets(result.sets.filter((s) => !s.builtin));
    setActiveSet(saveName.trim());
    setSaveName(null);
  }

  function deleteActive() {
    persistSets(removeSet(stored, activeSet));
    setActiveSet("");
  }

  const activeIsStored = stored.some((s) => s.name === activeSet);

  // ── Size ──
  const { pools, printers, targets } = usePrintTargets();
  // A template that fixes both sides doesn't depend on the printer's size, so
  // the printer there is only something to check the canvas against.
  const [checkKey, setCheckKey] = useState("");
  const fixedSize = template?.size;
  const bothFixed =
    fixedSize?.widthMm !== undefined && fixedSize?.lengthMm !== undefined;
  const sizePrinter = printers.find(
    (p) => p.id === (bothFixed ? checkKey : sizeKey),
  );
  const printerSize =
    sizePrinter &&
    sizePrinter.dpi !== null &&
    sizePrinter.widthDots !== null &&
    sizePrinter.lengthDots !== null
      ? {
          dpi: sizePrinter.dpi,
          widthDots: sizePrinter.widthDots,
          lengthDots: sizePrinter.lengthDots,
        }
      : null;
  // A saved printer that no longer exists falls back to the custom size.
  const useCustom = !printerSize;
  const baseSize = (!bothFixed && printerSize) || {
    dpi: clamp(Math.trunc(+custom.dpi) || 203, 150, 600),
    widthDots: clamp(Math.trunc(+custom.widthDots) || 800, 100, 4000),
    lengthDots: clamp(Math.trunc(+custom.lengthDots) || 2060, 100, 4000),
  };
  // A template that fixes its label size decides the canvas (the server does
  // the same); the printer's size is then only the limit.
  const size = applyTemplateSize(baseSize, fixedSize);
  const printerTooSmall =
    sizePrinter !== undefined && fitsPrinter(size, sizePrinter) === "too-small";
  const dpiOptions = [
    ...new Set([203, 300, baseSize.dpi].sort((a, b) => a - b)),
  ];
  const previewPrinter = sizePrinter
    ? {
        name: sizePrinter.name ?? sizePrinter.serial,
        serial: sizePrinter.serial,
        ...(sizePrinter.pool ? { pool: sizePrinter.pool.name } : {}),
        ...(sizePrinter.relay ? { relay: sizePrinter.relay.name } : {}),
      }
    : undefined;

  // Remember the choices.
  useEffect(() => {
    savePrefs({
      template: templateName,
      size: { key: sizeKey, ...custom },
      zoom,
      guides,
    });
  }, [templateName, sizeKey, custom, zoom, guides]);

  // ── Compare ──
  const [compare, setCompare] = useState(false);
  const [compareKeys, setCompareKeys] = useState<string[]>([]);
  const compareOptions = [
    { key: CURRENT, label: "Current values" },
    ...sets.map((s) => ({ key: s.name, label: s.name })),
  ];
  const validKeys = compareKeys.filter((k) =>
    compareOptions.some((o) => o.key === k),
  );

  function toggleCompare(on: boolean) {
    setCompare(on);
    if (on && validKeys.length === 0) {
      setCompareKeys(compareOptions.slice(0, MAX_COMPARE).map((o) => o.key));
    }
  }

  function toggleKey(key: string) {
    setCompareKeys(
      validKeys.includes(key)
        ? validKeys.filter((k) => k !== key)
        : [...validKeys, key].slice(0, MAX_COMPARE),
    );
  }

  const entries = compare
    ? validKeys.flatMap((key) => {
        if (key === CURRENT) {
          return [{ label: "Current values", valuesKey: valueState.key }];
        }
        const set = sets.find((s) => s.name === key);
        return set
          ? [{ label: set.name, valuesKey: JSON.stringify(set.values ?? null) }]
          : [];
      })
    : [{ label: "Current values", valuesKey: valueState.key }];

  // A fixed number of hooks, one per possible pane.
  const request = (i: number) => {
    const entry = entries[i];
    return template && entry
      ? {
          template: template.name,
          valuesKey: entry.valuesKey,
          size,
          printer: previewPrinter,
          revision,
          debug: guides.debug,
        }
      : null;
  };
  const primary = usePreviewRender(request(0));
  const previews = [
    primary,
    usePreviewRender(request(1)),
    usePreviewRender(request(2)),
  ];

  // ── Stage ──
  const [stageRef, stageSize] = useElementSize<HTMLDivElement>();
  const [naturalDims, setNaturalDims] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const dims = naturalDims ?? {
    width: size.widthDots,
    height: size.lengthDots,
  };
  const panes = Math.max(entries.length, 1);
  const scale = zoomScale(zoom, dims, stageSize, {
    panes,
    reservedHeight: compare ? LABEL_HEIGHT : 0,
  });

  // The wheel zooms the canvas (with or without Ctrl, and for trackpad pinch);
  // panning is by dragging. The listener is native because React's wheel
  // handlers are passive and can't cancel the browser's own scroll and zoom.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const wheelAnchor = useRef<{
    fx: number;
    fy: number;
    mx: number;
    my: number;
  } | null>(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      wheelAnchor.current = {
        fx: (el.scrollLeft + mx) / el.scrollWidth,
        fy: (el.scrollTop + my) / el.scrollHeight,
        mx,
        my,
      };
      setZoom({
        kind: "percent",
        percent: wheelZoomPercent(scaleToPercent(scaleRef.current), e.deltaY),
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [stageRef]);
  // Left- or middle-button drag pans the canvas.
  const [panning, setPanning] = useState(false);
  const pan = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const startPan = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = stageRef.current;
    if ((e.button !== 0 && e.button !== 1) || !el) return;
    // Stops the browser's middle-click autoscroll from taking over.
    e.preventDefault();
    pan.current = {
      x: e.clientX,
      y: e.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
    };
    el.setPointerCapture(e.pointerId);
    setPanning(true);
  };
  const movePan = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = stageRef.current;
    const p = pan.current;
    if (!el || !p) return;
    el.scrollLeft = p.left - (e.clientX - p.x);
    el.scrollTop = p.top - (e.clientY - p.y);
  };
  const endPan = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pan.current) return;
    pan.current = null;
    stageRef.current?.releasePointerCapture(e.pointerId);
    setPanning(false);
  };
  // Keep the point under the cursor in place once the new size is laid out.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the scale changes
  useLayoutEffect(() => {
    const el = stageRef.current;
    const a = wheelAnchor.current;
    if (!el || !a) return;
    wheelAnchor.current = null;
    el.scrollLeft = a.fx * el.scrollWidth - a.mx;
    el.scrollTop = a.fy * el.scrollHeight - a.my;
  }, [scale, stageRef]);
  const error = status?.error ?? null;

  // ── Print ──
  const [printing, setPrinting] = useState(false);
  const [targetKey, setTargetKey] = useState("");
  const [copies, setCopies] = useState(1);

  const loadedAt = status ? new Date(status.loadedAt) : null;

  return (
    <Box
      sx={{
        // Cancels the layout's padding on all sides; its toolbar spacer
        // already clears the app bar.
        m: -3,
        height: { xs: "calc(100vh - 56px)", sm: "calc(100vh - 64px)" },
        display: "flex",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          flex: "0 0 380px",
          overflowY: "auto",
          p: 2,
          borderRight: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        <Stack spacing={3}>
          <Typography variant="h6">Template studio</Typography>
          {statusQuery.isError && (
            <Alert severity="error">{statusQuery.error.message}</Alert>
          )}
          <TextField
            select
            label="Mall"
            value={template ? template.name : ""}
            onChange={(e) => setTemplateName(e.target.value)}
            disabled={!status}
            fullWidth
          >
            {templates.map((t) => (
              <MenuItem key={t.name} value={t.name}>
                {t.name}
              </MenuItem>
            ))}
          </TextField>
          {status && templates.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              There are no custom templates yet.
            </Typography>
          )}

          {template && (
            <>
              <Stack spacing={1.5}>
                <Typography variant="subtitle1">Value sets</Typography>
                <TextField
                  select
                  label="Value set"
                  value={activeSet}
                  onChange={(e) => chooseSet(e.target.value)}
                  fullWidth
                >
                  <MenuItem value="">(custom values)</MenuItem>
                  {sets.map((s) => (
                    <MenuItem key={s.name} value={s.name}>
                      {s.name}
                    </MenuItem>
                  ))}
                </TextField>
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    disabled={!valueState.valid}
                    onClick={() => setSaveName(activeIsStored ? activeSet : "")}
                  >
                    Save as…
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    disabled={!activeIsStored}
                    onClick={deleteActive}
                  >
                    Delete
                  </Button>
                </Stack>
              </Stack>
              <TemplateValuesForm template={template} state={valueState} />
            </>
          )}

          <Divider />
          <Stack spacing={2}>
            <Typography variant="subtitle1">Size</Typography>
            {bothFixed && fixedSize ? (
              <>
                <TextField
                  select
                  label="Resolution"
                  value={baseSize.dpi}
                  onChange={(e) =>
                    setCustom((c) => ({ ...c, dpi: String(e.target.value) }))
                  }
                  fullWidth
                >
                  {dpiOptions.map((dpi) => (
                    <MenuItem key={dpi} value={dpi}>
                      {dpi} dpi
                    </MenuItem>
                  ))}
                </TextField>
                <Typography variant="body2" color="text.secondary">
                  {size.widthDots} × {size.lengthDots} dots, {size.dpi} dpi
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Fixed by the template: {describeTemplateSize(fixedSize)}
                </Typography>
                <TextField
                  select
                  label="Check against printer"
                  value={checkKey}
                  onChange={(e) => setCheckKey(e.target.value)}
                  fullWidth
                >
                  <MenuItem value="">None</MenuItem>
                  {printers.map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      {p.name ?? p.serial} ({FIT_LABELS[fitsPrinter(size, p)]})
                    </MenuItem>
                  ))}
                </TextField>
                {sizePrinter && printerTooSmall && (
                  <Alert severity="warning">
                    This printer reports a smaller label (
                    {sizePrinter.widthDots ?? "?"}x
                    {sizePrinter.lengthDots ?? "?"} dots); jobs will fail.
                  </Alert>
                )}
              </>
            ) : (
              <>
                <TextField
                  select
                  label="Printer"
                  value={sizeKey}
                  onChange={(e) => setSizeKey(e.target.value)}
                  fullWidth
                >
                  <MenuItem value={CUSTOM}>Custom size</MenuItem>
                  {printers.map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      {p.name ?? p.serial}
                    </MenuItem>
                  ))}
                </TextField>
                {sizePrinter && !printerSize && (
                  <Typography variant="body2" color="text.secondary">
                    The printer has not reported its size yet. Enter the
                    dimensions yourself.
                  </Typography>
                )}
                {printerSize && (
                  <Typography variant="body2" color="text.secondary">
                    {printerSize.dpi} dpi, {printerSize.widthDots} ×{" "}
                    {printerSize.lengthDots} dots
                  </Typography>
                )}
                {fixedSize && (
                  <Typography variant="body2" color="text.secondary">
                    Fixed by the template: {describeTemplateSize(fixedSize)}
                  </Typography>
                )}
                {sizePrinter && printerTooSmall && printerSize && (
                  <Alert severity="warning">
                    This printer reports a smaller label (
                    {printerSize.widthDots}x{printerSize.lengthDots} dots); jobs
                    will fail.
                  </Alert>
                )}
                {useCustom && (
                  <Stack direction="row" spacing={1}>
                    <TextField
                      label="dpi"
                      type="number"
                      value={custom.dpi}
                      onChange={(e) =>
                        setCustom((c) => ({ ...c, dpi: e.target.value }))
                      }
                      slotProps={{ htmlInput: { min: 150, max: 600 } }}
                    />
                    <TextField
                      label="Width"
                      type="number"
                      value={
                        fixedSize?.widthMm === undefined
                          ? custom.widthDots
                          : size.widthDots
                      }
                      disabled={fixedSize?.widthMm !== undefined}
                      onChange={(e) =>
                        setCustom((c) => ({ ...c, widthDots: e.target.value }))
                      }
                      slotProps={{ htmlInput: { min: 100, max: 4000 } }}
                    />
                    <TextField
                      label="Length"
                      type="number"
                      value={
                        fixedSize?.lengthMm === undefined
                          ? custom.lengthDots
                          : size.lengthDots
                      }
                      disabled={fixedSize?.lengthMm !== undefined}
                      onChange={(e) =>
                        setCustom((c) => ({ ...c, lengthDots: e.target.value }))
                      }
                      slotProps={{ htmlInput: { min: 100, max: 4000 } }}
                    />
                  </Stack>
                )}
              </>
            )}
          </Stack>

          <Divider />
          <Stack spacing={1}>
            <Typography variant="subtitle1">Guides</Typography>
            <FormControlLabel
              label="Margin"
              control={
                <Switch
                  checked={guides.margin}
                  onChange={(e) =>
                    setGuides((g) => ({ ...g, margin: e.target.checked }))
                  }
                />
              }
            />
            {guides.margin && (
              <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                <Slider
                  min={0}
                  max={MAX_MARGIN_MM}
                  step={0.5}
                  value={guides.marginMm}
                  onChange={(_, v) =>
                    setGuides((g) => ({ ...g, marginMm: clampMargin(+v) }))
                  }
                  aria-label="Margin in millimeters"
                />
                <Typography variant="body2" sx={{ minWidth: 56 }}>
                  {guides.marginMm} mm
                </Typography>
              </Stack>
            )}
            <FormControlLabel
              label="Horizontal center line"
              control={
                <Switch
                  checked={guides.centerH}
                  onChange={(e) =>
                    setGuides((g) => ({ ...g, centerH: e.target.checked }))
                  }
                />
              }
            />
            <FormControlLabel
              label="Vertical center line"
              control={
                <Switch
                  checked={guides.centerV}
                  onChange={(e) =>
                    setGuides((g) => ({ ...g, centerV: e.target.checked }))
                  }
                />
              }
            />
            <FormControlLabel
              label="Debug outlines (preview isn't 1-bit)"
              control={
                <Switch
                  checked={guides.debug}
                  onChange={(e) =>
                    setGuides((g) => ({ ...g, debug: e.target.checked }))
                  }
                />
              }
            />
          </Stack>

          <Divider />
          <Stack spacing={1.5}>
            <Typography variant="subtitle1">Zoom</Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              fullWidth
              value={zoom.kind}
              onChange={(_, kind: ZoomMode["kind"] | null) => {
                if (kind === "height" || kind === "width") setZoom({ kind });
                else if (kind === "percent") {
                  setZoom({
                    kind,
                    percent: clampPercent(scaleToPercent(scale)),
                  });
                }
              }}
            >
              <ToggleButton value="height">Fit height</ToggleButton>
              <ToggleButton value="width">Fit width</ToggleButton>
              <ToggleButton value="percent">Custom</ToggleButton>
            </ToggleButtonGroup>
            <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
              <Slider
                min={MIN_PERCENT}
                max={MAX_PERCENT}
                value={clampPercent(scaleToPercent(scale))}
                onChange={(_, v) =>
                  setZoom({ kind: "percent", percent: clampPercent(+v) })
                }
                aria-label="Zoom in percent"
              />
              <Typography variant="body2" sx={{ minWidth: 48 }}>
                {scaleToPercent(scale)} %
              </Typography>
            </Stack>
          </Stack>

          <Divider />
          <Stack spacing={1}>
            <FormControlLabel
              label="Compare value sets"
              control={
                <Switch
                  checked={compare}
                  onChange={(e) => toggleCompare(e.target.checked)}
                />
              }
            />
            {compare && (
              <>
                <Typography variant="body2" color="text.secondary">
                  Select up to {MAX_COMPARE}.
                </Typography>
                {compareOptions.map((o) => (
                  <FormControlLabel
                    key={o.key}
                    label={<ListItemText primary={o.label} />}
                    control={
                      <Checkbox
                        checked={validKeys.includes(o.key)}
                        disabled={
                          !validKeys.includes(o.key) &&
                          validKeys.length >= MAX_COMPARE
                        }
                        onChange={() => toggleKey(o.key)}
                      />
                    }
                  />
                ))}
              </>
            )}
          </Stack>
        </Stack>
      </Box>

      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {error && (
          <Alert severity="error" sx={{ borderRadius: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              The templates could not be loaded. The last working version is
              shown.
            </Typography>
            <Box
              component="pre"
              sx={{
                m: 0,
                mt: 1,
                fontFamily: "monospace",
                fontSize: 12,
                whiteSpace: "pre-wrap",
                maxHeight: 160,
                overflow: "auto",
              }}
            >
              {error.join("\n")}
            </Box>
          </Alert>
        )}
        <Box
          ref={stageRef}
          onPointerDown={startPan}
          onMouseDown={(e) => e.button === 1 && e.preventDefault()}
          onPointerMove={movePan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          // The browser's own image drag would fight the pan.
          onDragStart={(e) => e.preventDefault()}
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            cursor: panning ? "grabbing" : "grab",
            userSelect: "none",
            ...checkerSx,
          }}
        >
          <Box
            sx={{
              display: "flex",
              minWidth: "100%",
              minHeight: "100%",
              boxSizing: "border-box",
              p: 3,
              width: "max-content",
            }}
          >
            <Box sx={{ display: "flex", gap: 3, m: "auto" }}>
              {template && (compare || valueState.valid)
                ? entries.map((entry, i) => (
                    <StudioPane
                      key={entry.label}
                      label={entry.label}
                      preview={previews[i] ?? primary}
                      scale={scale}
                      dims={dims}
                      dpi={size.dpi}
                      guides={guides}
                      dimmed={error !== null}
                      showLabel={compare}
                      onDims={setNaturalDims}
                    />
                  ))
                : null}
              {template && !compare && !valueState.valid && (
                <Typography
                  variant="body2"
                  sx={{ bgcolor: "background.paper", p: 1 }}
                >
                  Fill in the values to preview
                </Typography>
              )}
              {!template && status && (
                <Typography
                  variant="body2"
                  sx={{ bgcolor: "background.paper", p: 1 }}
                >
                  Select a template to preview it
                </Typography>
              )}
            </Box>
          </Box>
        </Box>

        <Stack
          direction="row"
          spacing={2}
          sx={{
            alignItems: "center",
            flexWrap: "wrap",
            rowGap: 1,
            px: 2,
            py: 1,
            borderTop: 1,
            borderColor: "divider",
            bgcolor: "background.paper",
          }}
        >
          <Typography variant="body2" sx={{ flex: 1, minWidth: 240 }}>
            {size.widthDots} × {size.lengthDots} dots, {size.dpi} dpi
            {!compare && primary.ms !== null && ` · ${primary.ms} ms`}
            {!compare &&
              primary.blackPercent !== null &&
              ` · ${primary.blackPercent.toLocaleString("en-US", { maximumFractionDigits: 1 })} % black`}
            {loadedAt && ` · Loaded ${loadedAt.toLocaleTimeString("en-GB")}`}
          </Typography>
          <Button
            size="small"
            disabled={!primary.url}
            component="a"
            href={primary.url ?? undefined}
            download={
              template ? `${template.name}-${size.dpi}dpi.png` : "template.png"
            }
          >
            Download PNG
          </Button>
          <Button
            size="small"
            disabled={reloadMutation.isPending}
            onClick={() => reloadMutation.mutate()}
          >
            Reload
          </Button>
          <Button
            size="small"
            variant="contained"
            disabled={!template || !valueState.valid}
            onClick={() => setPrinting(true)}
          >
            Print...
          </Button>
        </Stack>
      </Box>

      {saveName !== null && (
        <Dialog open onClose={() => setSaveName(null)} maxWidth="xs" fullWidth>
          <DialogTitle>Save value set</DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              label="Name"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                // Closing hands focus back to "Save as…"; without this the
                // same Enter press would then click it and reopen the dialog.
                e.preventDefault();
                commitSave();
              }}
              sx={{ mt: 1 }}
              fullWidth
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSaveName(null)}>Cancel</Button>
            <Button variant="contained" onClick={commitSave}>
              Save
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {printing && template && (
        <PrintConfirmDialog
          templateName={template.name}
          values={valueState.values}
          target={targets.find((t) => t.key === targetKey)}
          copies={copies}
          onClose={() => setPrinting(false)}
        >
          <PrintTargetFields
            pools={pools}
            printers={printers}
            targetKey={targetKey}
            onTargetKey={setTargetKey}
            copies={copies}
            onCopies={setCopies}
          />
        </PrintConfirmDialog>
      )}
    </Box>
  );
}
