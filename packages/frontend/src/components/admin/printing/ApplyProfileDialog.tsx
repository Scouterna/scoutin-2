import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/api/api";
import { apiErrorMessage } from "./PrinterApiError";
import type { Printer } from "./PrintersTab";
import { sameSettingValue } from "./profileValues";

type Settings = Record<string, string>;

type ApplyResult = {
  ok: boolean;
  error?: string;
  restart?: boolean;
  results?: Record<string, { applied: boolean; value: string }>;
};

/** The settings the printer reported on connect, or null when unknown. */
function reportedSettings(printer: Printer): Settings | null {
  const config = printer.config;
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return null;
  }
  return config as Settings;
}

export function ApplyProfileDialog({
  printer,
  poolProfile,
  open,
  onClose,
  onApplied,
}: {
  printer: Printer;
  poolProfile: string | null;
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [choice, setChoice] = useState<string | null>(null);

  const profilesQuery = useQuery({
    queryKey: ["admin", "printing", "profiles"],
    queryFn: async () => {
      const res = await api.admin.printing.profiles.$get();
      if (!res.ok) throw new Error("Kunde inte ladda profilerna");
      return await res.json();
    },
    enabled: open,
  });

  const applyMutation = useMutation({
    mutationFn: async (profile: string) => {
      const res = await api.admin.printing.printers[":id"].actions.$post({
        param: { id: printer.id },
        json: { kind: "applyProfile", profile },
      });
      if (!res.ok) {
        throw new Error(
          await apiErrorMessage(res, "Kunde inte tillämpa profilen"),
        );
      }
      return (await res.json()) as ApplyResult;
    },
    onSettled: () => onApplied(),
  });

  const profiles = profilesQuery.data?.profiles ?? [];
  const problems = profilesQuery.data?.problems ?? [];
  const poolMissing =
    profilesQuery.isSuccess &&
    poolProfile !== null &&
    !profiles.some((p) => p.name === poolProfile);
  const selected =
    choice ?? (poolProfile !== null && !poolMissing ? poolProfile : "");
  const profile = profiles.find((p) => p.name === selected);

  const current = reportedSettings(printer);
  const rows = Object.entries(profile?.settings ?? {}).map(([key, wanted]) => {
    const now = current?.[key];
    return {
      key,
      wanted,
      now,
      differs: now === undefined || !sameSettingValue(wanted, now),
    };
  });
  const differing = rows.filter((row) => row.differs).length;

  const result = applyMutation.data;
  const done = applyMutation.isSuccess || applyMutation.isError;
  const busy = applyMutation.isPending;

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>Tillämpa profil</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2">
            Skrivare: <strong>{printer.name ?? printer.serial}</strong>
          </Typography>

          {profilesQuery.isError && (
            <Alert severity="error">Kunde inte ladda profilerna.</Alert>
          )}
          {problems.length > 0 && (
            <Alert severity="error">
              Profilfilen på servern har fel:
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </Box>
            </Alert>
          )}
          {poolMissing && (
            <Alert severity="warning">
              Skrivarpoolens profil "{poolProfile}" finns inte på servern.
            </Alert>
          )}
          {profilesQuery.isSuccess && profiles.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              Inga profiler finns på servern.
            </Typography>
          )}

          {!done && (
            <Alert severity="warning">
              <Typography variant="body2" component="div">
                Åtgärden ändrar skrivarens inställningar. Bara inställningar som
                skiljer sig från profilen ändras. Skrivaren kan starta om om
                nätverks-, Bluetooth- eller språkinställningar ändras. Åtgärden
                körs bara när skrivaren är ledig och inga jobb skrivs ut. Prova
                först på en enda skrivare.
              </Typography>
            </Alert>
          )}

          <TextField
            select
            label="Profil"
            value={selected}
            onChange={(e) => setChoice(e.target.value)}
            disabled={busy || done || profiles.length === 0}
            fullWidth
          >
            {profiles.map((p) => (
              <MenuItem key={p.name} value={p.name}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>

          {busy && (
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <CircularProgress size={20} />
              <Typography variant="body2">
                Tillämpar… kan ta upp till en minut
              </Typography>
            </Stack>
          )}

          {applyMutation.isError && (
            <Alert severity="error">{applyMutation.error.message}</Alert>
          )}

          {result && (
            <>
              <Alert severity={result.ok ? "success" : "error"}>
                {result.ok
                  ? "Profilen tillämpades."
                  : "Profilen tillämpades inte helt."}
                {result.error ? ` ${result.error}` : ""}
                {result.restart
                  ? " Skrivaren startar om och kommer tillbaka av sig själv."
                  : ""}
              </Alert>
              {result.results && (
                <TableContainer sx={{ maxHeight: "50vh" }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Inställning</TableCell>
                        <TableCell>Resultat</TableCell>
                        <TableCell>Värde nu</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {Object.entries(result.results).map(([key, r]) => (
                        <TableRow key={key}>
                          <TableCell>{key}</TableCell>
                          <TableCell>
                            {r.applied ? "✓" : "✗ inte tillämpad"}
                          </TableCell>
                          <TableCell>{r.value}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </>
          )}

          {!done && profile && (
            <>
              <Typography variant="body2" color="text.secondary">
                {differing} av {rows.length}{" "}
                {differing === 1
                  ? "inställning skiljer sig"
                  : "inställningar skiljer sig"}
              </Typography>
              <TableContainer sx={{ maxHeight: "50vh" }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Inställning</TableCell>
                      <TableCell>Profil</TableCell>
                      <TableCell>Skrivaren nu</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow
                        key={row.key}
                        sx={
                          row.differs
                            ? { bgcolor: "action.selected" }
                            : undefined
                        }
                      >
                        <TableCell>{row.key}</TableCell>
                        <TableCell>{row.wanted}</TableCell>
                        <TableCell>{row.now ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {done ? (
          <Button onClick={onClose}>Stäng</Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>
              Avbryt
            </Button>
            <Button
              variant="contained"
              disabled={!profile || busy || !profilesQuery.isSuccess}
              onClick={() => applyMutation.mutate(selected)}
            >
              Tillämpa
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
