import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { useEffect, useState } from "react";
import { api } from "@/api/api";
import {
  clamp,
  PrintConfirmDialog,
  PrintTargetFields,
  usePrintTargets,
} from "./PrintDialog";
import { apiErrorMessage } from "./PrinterApiError";
import { TemplateValuesForm, useTemplateValues } from "./TemplateValues";

type Template = InferResponseType<
  typeof api.admin.printing.templates.$get
>["templates"][number];

const KIND_LABEL: Record<Template["kind"], string> = {
  builtin: "inbyggd",
  static: "bild",
  tsx: "mall",
};

const CUSTOM = "custom";
const PREVIEW_DELAY_MS = 600;

type Size = { dpi: number; widthDots: number; lengthDots: number };

export function PrintTab() {
  const [templateName, setTemplateName] = useState("");

  const [sizeKey, setSizeKey] = useState(CUSTOM);
  const [custom, setCustom] = useState({
    dpi: "203",
    widthDots: "800",
    lengthDots: "2060",
  });

  const [targetKey, setTargetKey] = useState("");
  const [copies, setCopies] = useState(1);
  const [confirming, setConfirming] = useState(false);

  const templatesQuery = useQuery({
    queryKey: ["admin", "printing", "templates"],
    queryFn: async () => {
      const res = await api.admin.printing.templates.$get();
      if (!res.ok) throw new Error("Kunde inte ladda mallarna");
      return (await res.json()).templates;
    },
  });
  const { pools, printers, targets } = usePrintTargets();

  const templates = templatesQuery.data ?? [];
  const template = templates.find((t) => t.name === templateName);

  // ── Values ──
  const valueState = useTemplateValues(template);
  const values = valueState.values;
  const valuesValid = valueState.valid;
  const valuesKey = valueState.key;

  function selectTemplate(name: string) {
    setTemplateName(name);
    valueState.reset(templates.find((t) => t.name === name));
  }

  // ── Preview size ──
  const sizePrinter = printers.find((p) => p.id === sizeKey);
  const printerSize: Size | null =
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
  const useCustom = !printerSize;
  const customSize: Size = {
    dpi: clamp(Math.trunc(+custom.dpi) || 203, 150, 600),
    widthDots: clamp(Math.trunc(+custom.widthDots) || 800, 100, 4000),
    lengthDots: clamp(Math.trunc(+custom.lengthDots) || 2060, 100, 4000),
  };
  const size = printerSize ?? customSize;
  const previewPrinter = sizePrinter
    ? {
        name: sizePrinter.name ?? sizePrinter.serial,
        serial: sizePrinter.serial,
        ...(sizePrinter.pool ? { pool: sizePrinter.pool.name } : {}),
        ...(sizePrinter.relay ? { relay: sizePrinter.relay.name } : {}),
      }
    : undefined;
  const previewPrinterKey = JSON.stringify(previewPrinter ?? null);

  // ── Preview ──
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: valuesKey and previewPrinterKey stand for values and previewPrinter
  useEffect(() => {
    if (!templateName || valuesKey === null) {
      setPreviewLoading(false);
      return;
    }
    const controller = new AbortController();
    setPreviewLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.admin.printing.templates[":name"].preview.$post(
          {
            param: { name: templateName },
            json: {
              values: JSON.parse(valuesKey),
              ...size,
              ...(previewPrinter ? { printer: previewPrinter } : {}),
            },
          },
          { init: { signal: controller.signal } },
        );
        if (!res.ok) {
          throw new Error(await apiErrorMessage(res, `Fel ${res.status}`));
        }
        const url = URL.createObjectURL(await res.blob());
        if (controller.signal.aborted) {
          URL.revokeObjectURL(url);
          return;
        }
        setPreviewUrl(url);
        setPreviewError(null);
        setPreviewLoading(false);
      } catch (err) {
        if (controller.signal.aborted) return;
        setPreviewError(err instanceof Error ? err.message : "Okänt fel");
        setPreviewLoading(false);
      }
    }, PREVIEW_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    templateName,
    valuesKey,
    size.dpi,
    size.widthDots,
    size.lengthDots,
    previewPrinterKey,
  ]);

  // Free the URL of a replaced preview, and of the last one on unmount.
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  // ── Send ──
  const target = targets.find((o) => o.key === targetKey);
  const ready = template !== undefined && valuesValid && target !== undefined;

  return (
    <Box
      sx={{
        display: "flex",
        gap: 4,
        flexDirection: { xs: "column-reverse", md: "row" },
        alignItems: { md: "flex-start" },
      }}
    >
      <Stack spacing={3} sx={{ flex: 1, minWidth: 0, maxWidth: 560 }}>
        {templatesQuery.isError && (
          <Alert severity="error">Kunde inte ladda mallarna.</Alert>
        )}
        <TextField
          select
          label="Mall"
          value={templateName}
          onChange={(e) => selectTemplate(e.target.value)}
          disabled={templatesQuery.isLoading}
          fullWidth
        >
          {templates.map((t) => (
            <MenuItem key={t.name} value={t.name}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                {t.name}
                <Chip
                  size="small"
                  variant="outlined"
                  label={KIND_LABEL[t.kind]}
                />
              </Box>
            </MenuItem>
          ))}
        </TextField>
        {!templatesQuery.isLoading &&
          templates.every((t) => t.kind === "builtin") && (
            <Typography variant="body2" color="text.secondary">
              Det finns inga egna mallar än, bara inbyggda.
            </Typography>
          )}

        {template && (
          <TemplateValuesForm template={template} state={valueState} />
        )}

        <Stack spacing={2}>
          <Typography variant="subtitle1">Förhandsgranskning</Typography>
          <TextField
            select
            label="Skrivare för förhandsgranskning"
            value={sizeKey}
            onChange={(e) => setSizeKey(e.target.value)}
            fullWidth
          >
            <MenuItem value={CUSTOM}>Eget mått</MenuItem>
            {printers.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name ?? p.serial}
              </MenuItem>
            ))}
          </TextField>
          {sizePrinter && !printerSize && (
            <Typography variant="body2" color="text.secondary">
              Skrivaren har inte rapporterat sin storlek än. Fyll i måtten
              själv.
            </Typography>
          )}
          {printerSize && (
            <Typography variant="body2" color="text.secondary">
              {printerSize.dpi} dpi, {printerSize.widthDots} ×{" "}
              {printerSize.lengthDots} punkter
            </Typography>
          )}
          {useCustom && (
            <Stack direction="row" spacing={2}>
              <TextField
                label="dpi"
                type="number"
                sx={{ flex: 1, minWidth: 0 }}
                value={custom.dpi}
                onChange={(e) =>
                  setCustom((c) => ({ ...c, dpi: e.target.value }))
                }
                slotProps={{ htmlInput: { min: 150, max: 600 } }}
              />
              <TextField
                label="Bredd i punkter"
                type="number"
                sx={{ flex: 1, minWidth: 0 }}
                value={custom.widthDots}
                onChange={(e) =>
                  setCustom((c) => ({ ...c, widthDots: e.target.value }))
                }
                slotProps={{ htmlInput: { min: 100, max: 4000 } }}
              />
              <TextField
                label="Längd i punkter"
                type="number"
                sx={{ flex: 1, minWidth: 0 }}
                value={custom.lengthDots}
                onChange={(e) =>
                  setCustom((c) => ({ ...c, lengthDots: e.target.value }))
                }
                slotProps={{ htmlInput: { min: 100, max: 4000 } }}
              />
            </Stack>
          )}
        </Stack>

        <Stack spacing={2}>
          <Typography variant="subtitle1">Skriv ut</Typography>
          <PrintTargetFields
            pools={pools}
            printers={printers}
            targetKey={targetKey}
            onTargetKey={setTargetKey}
            copies={copies}
            onCopies={setCopies}
          />
          <div>
            <Button
              variant="contained"
              disabled={!ready}
              onClick={() => setConfirming(true)}
            >
              Skriv ut
            </Button>
          </div>
        </Stack>
      </Stack>

      <Box
        sx={{
          flex: "0 0 auto",
          width: { xs: "100%", md: 360 },
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        <Box
          sx={{
            position: "relative",
            width: "100%",
            // The picture sets the height (the label's own proportions); the
            // placeholder text only needs something to sit in.
            minHeight: previewUrl ? undefined : 240,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            bgcolor: "action.hover",
            overflow: "hidden",
          }}
        >
          {previewUrl && template ? (
            <Box
              component="img"
              src={previewUrl}
              alt={`Förhandsgranskning av ${template.name}`}
              sx={{
                display: "block",
                width: "100%",
                height: "auto",
                bgcolor: "#fff",
                imageRendering: "pixelated",
                opacity: previewLoading ? 0.5 : 1,
                transition: "opacity 150ms",
              }}
            />
          ) : (
            <Typography variant="body2" color="text.secondary">
              {template
                ? valuesValid
                  ? "Förhandsgranskas…"
                  : "Fyll i värdena för att förhandsgranska"
                : "Välj en mall för att förhandsgranska den"}
            </Typography>
          )}
          {previewLoading && (
            <CircularProgress
              size={20}
              sx={{ position: "absolute", top: 8, right: 8 }}
            />
          )}
        </Box>
        {/* Reserved height, so an error doesn't push the layout. */}
        <Typography variant="caption" color="error" sx={{ minHeight: "2.6em" }}>
          {previewError
            ? `Förhandsgranskningen misslyckades: ${previewError}`
            : " "}
        </Typography>
      </Box>

      {confirming && template && target && (
        <PrintConfirmDialog
          templateName={template.name}
          values={values}
          target={target}
          copies={copies}
          onClose={() => setConfirming(false)}
        />
      )}
    </Box>
  );
}
