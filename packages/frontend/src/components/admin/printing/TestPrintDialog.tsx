// Temporary: prints a ready-made PNG until templates exist. Remove with the
// "Test print" button in JobsTab.
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import ListSubheader from "@mui/material/ListSubheader";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "@/api/api";
import { PngError, type PngFile, readPngFile, readPngUrl } from "./JobPng";
import { TEST_IMAGES } from "./testImages";

// Value of the image select for "Upload a PNG…". Built-in images use their ids.
const UPLOAD = "__upload__";

export type PrintTarget = {
  kind: "pool" | "printer";
  id: string;
  name: string;
};

type Option = PrintTarget;

export function TestPrintDialog({
  pools,
  printers,
  onClose,
  onDone,
}: {
  pools: { id: string; name: string }[];
  printers: { id: string; name: string }[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [targetKey, setTargetKey] = useState("");
  const [choice, setChoice] = useState<string>(TEST_IMAGES[0]?.id ?? UPLOAD);
  const [upload, setUpload] = useState<{
    png: PngFile;
    previewUrl: string;
  } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [copies, setCopies] = useState(1);
  const [confirming, setConfirming] = useState(false);

  const builtin = TEST_IMAGES.find((image) => image.id === choice);
  const builtinQuery = useQuery({
    queryKey: ["admin", "printing", "test-image", builtin?.id],
    queryFn: async () => {
      if (!builtin) throw new Error("Ingen inbyggd bild är vald");
      return readPngUrl(builtin.url, builtin.name);
    },
    enabled: builtin !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  // Free the preview URL of a replaced upload, and of the last one on close.
  useEffect(
    () => () => {
      if (upload) URL.revokeObjectURL(upload.previewUrl);
    },
    [upload],
  );

  const isUpload = choice === UPLOAD;
  const file: PngFile | null = isUpload
    ? (upload?.png ?? null)
    : (builtinQuery.data ?? null);
  const previewSrc = isUpload ? upload?.previewUrl : builtin?.url;
  const fileError = isUpload
    ? uploadError
    : builtinQuery.error instanceof PngError
      ? builtinQuery.error.message
      : builtinQuery.error
        ? "Bilden kunde inte läsas."
        : null;

  const options: Option[] = [
    ...pools.map((p) => ({ kind: "pool" as const, ...p })),
    ...printers.map((p) => ({ kind: "printer" as const, ...p })),
  ];
  const target = options.find((o) => `${o.kind}:${o.id}` === targetKey);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!target || !file) throw new Error("Mål eller fil saknas");
      const res = await api.admin.printing.jobs.png.$post({
        json: {
          png: file.base64,
          copies,
          ...(target.kind === "pool"
            ? { poolId: target.id }
            : { printerId: target.id }),
        },
      });
      if (!res.ok) {
        let message = "Kunde inte köa utskriften";
        try {
          const body = (await res.json()) as { error?: unknown };
          if (typeof body.error === "string") message = body.error;
        } catch {
          // keep the fallback
        }
        throw new Error(message);
      }
      return await res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "printing", "jobs"],
      });
      const n = result.jobs.length;
      onDone(`${n} jobb köades`);
      onClose();
    },
  });

  async function onFile(f: File | undefined) {
    setUpload(null);
    setUploadError(null);
    if (!f) return;
    try {
      const png = await readPngFile(f);
      setUpload({ png, previewUrl: URL.createObjectURL(f) });
    } catch (err) {
      setUploadError(
        err instanceof PngError ? err.message : "Filen kunde inte läsas.",
      );
    }
  }

  const ready = target !== undefined && file !== null && copies >= 1;

  if (confirming && target) {
    return (
      <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
        <DialogTitle>Testutskrift</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Skriv ut {copies} {copies === 1 ? "kopia" : "kopior"} av{" "}
            {file?.name ?? "bilden"} på {target.name}?
          </DialogContentText>
          {mutation.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {mutation.error.message}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setConfirming(false)}
            disabled={mutation.isPending}
          >
            Tillbaka
          </Button>
          <Button
            variant="contained"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            Skriv ut
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Testutskrift</DialogTitle>
      <DialogContent>
        <Box
          sx={{
            display: "flex",
            gap: 3,
            mt: 1,
            flexDirection: { xs: "column-reverse", sm: "row" },
          }}
        >
          <Stack spacing={2} sx={{ flex: 1, minWidth: 0 }}>
            <TextField
              select
              label="Mål"
              value={targetKey}
              onChange={(e) => setTargetKey(e.target.value)}
              fullWidth
            >
              <ListSubheader>Skrivarpooler</ListSubheader>
              {pools.map((p) => (
                <MenuItem key={p.id} value={`pool:${p.id}`}>
                  {p.name}
                </MenuItem>
              ))}
              <ListSubheader>Skrivare</ListSubheader>
              {printers.map((p) => (
                <MenuItem key={p.id} value={`printer:${p.id}`}>
                  {p.name}
                </MenuItem>
              ))}
            </TextField>
            <div>
              <TextField
                select
                label="Bild"
                value={choice}
                onChange={(e) => setChoice(e.target.value)}
                fullWidth
              >
                {TEST_IMAGES.map((image) => (
                  <MenuItem key={image.id} value={image.id}>
                    {image.name}
                  </MenuItem>
                ))}
                <MenuItem value={UPLOAD}>Ladda upp en PNG…</MenuItem>
              </TextField>
              {builtin && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 1 }}
                >
                  {builtin.description}
                </Typography>
              )}
              {isUpload && (
                <Button variant="outlined" component="label" sx={{ mt: 2 }}>
                  Välj PNG
                  <input
                    type="file"
                    accept="image/png"
                    hidden
                    onChange={(e) => {
                      void onFile(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </Button>
              )}
              {fileError && (
                <Typography color="error" variant="body2" sx={{ mt: 1 }}>
                  {fileError}
                </Typography>
              )}
            </div>
            <TextField
              label="Antal kopior"
              type="number"
              value={copies}
              onChange={(e) =>
                setCopies(
                  Math.min(10, Math.max(1, Math.trunc(+e.target.value) || 1)),
                )
              }
              slotProps={{ htmlInput: { min: 1, max: 10 } }}
              fullWidth
            />
          </Stack>
          <Box
            sx={{
              flex: "0 0 auto",
              width: { xs: "100%", sm: 170 },
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 1,
            }}
          >
            <Box
              sx={{
                width: "100%",
                height: { xs: 180, sm: 380 },
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
              {file && previewSrc ? (
                <Box
                  component="img"
                  src={previewSrc}
                  alt={`Förhandsgranskning av ${file.name}`}
                  sx={{
                    maxHeight: "100%",
                    maxWidth: "100%",
                    bgcolor: "#fff",
                    imageRendering: "pixelated",
                  }}
                />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {isUpload
                    ? "Välj en PNG för att förhandsgranska den"
                    : builtinQuery.isFetching
                      ? "Laddar…"
                      : "Ingen förhandsgranskning"}
                </Typography>
              )}
            </Box>
            {/* Always two lines tall, so the dialog doesn't jump when an image loads. */}
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                textAlign: "center",
                minHeight: "2.6em",
                width: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {file ? file.name : "\u00a0"}
              <br />
              {file ? `${file.width} × ${file.height} px` : "\u00a0"}
            </Typography>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Avbryt</Button>
        <Button
          variant="contained"
          disabled={!ready}
          onClick={() => setConfirming(true)}
        >
          Skriv ut
        </Button>
      </DialogActions>
    </Dialog>
  );
}
