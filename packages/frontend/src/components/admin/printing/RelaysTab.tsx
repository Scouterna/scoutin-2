import {
  Add,
  EditOutlined,
  LinkOff,
  PowerSettingsNew,
  RestartAlt,
} from "@mui/icons-material";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/api";
import { PairRelayDialog } from "./PairRelayDialog";
import {
  assertRelayOk,
  type Relay,
  type RelayActionKind,
  relaysQueryKey,
} from "./RelayApi";
import { RelayConfirmDialog } from "./RelayConfirmDialog";
import { RelayRelativeTime } from "./RelayRelativeTime";
import { RelayRenameDialog } from "./RelayRenameDialog";

type Confirm =
  | { kind: "revoke"; relay: Relay }
  | { kind: RelayActionKind; relay: Relay };

const actionLabels: Record<RelayActionKind, { done: string; verb: string }> = {
  reboot: { done: "Reläet startar om", verb: "Starta om" },
  poweroff: { done: "Reläet stängs av", verb: "Stäng av" },
};

export function RelaysTab() {
  const queryClient = useQueryClient();
  const [pairing, setPairing] = useState(false);
  const [renaming, setRenaming] = useState<Relay | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  // Relays with an action in flight. Only that row is locked; the page isn't.
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());

  const { data, isLoading, isError } = useQuery({
    queryKey: relaysQueryKey,
    queryFn: async () => {
      const res = await api.admin.printing.relays.$get();
      await assertRelayOk(res);
      return (await res.json()).relays;
    },
    // Relays report in and out; stop polling while the tab is hidden.
    refetchInterval: 5000,
  });

  const setBusyFor = (id: string, isBusy: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (isBusy) next.add(id);
      else next.delete(id);
      return next;
    });

  const revoke = useMutation({
    mutationFn: async (relay: Relay) => {
      const res = await api.admin.printing.relays[":id"].revoke.$post({
        param: { id: relay.id },
      });
      await assertRelayOk(res);
    },
    onSuccess: (_data, relay) => {
      queryClient.invalidateQueries({ queryKey: relaysQueryKey });
      toast.success(`${relay.name} återkallades`);
    },
    onError: (e) => toast.error(e.message),
  });

  // Reboot and power off wait for the relay's answer (up to two minutes).
  const action = useMutation({
    mutationFn: async ({
      relay,
      kind,
    }: {
      relay: Relay;
      kind: RelayActionKind;
    }) => {
      const res = await api.admin.printing.relays[":id"].actions.$post({
        param: { id: relay.id },
        json: { kind },
      });
      await assertRelayOk(res);
      // 200 carries { ok, error? }; a relay that failed to act says so there.
      const body = await res.json();
      if ("error" in body && body.error) throw new Error(body.error);
      if (!("ok" in body) || !body.ok) {
        throw new Error("Reläet bekräftade inte");
      }
    },
    onMutate: ({ relay }) => setBusyFor(relay.id, true),
    onSettled: (_data, _error, { relay }) => setBusyFor(relay.id, false),
    onSuccess: (_data, { relay, kind }) => {
      queryClient.invalidateQueries({ queryKey: relaysQueryKey });
      toast.success(`${actionLabels[kind].done}: ${relay.name}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const runConfirmed = () => {
    if (!confirm) return;
    if (confirm.kind === "revoke") revoke.mutate(confirm.relay);
    else action.mutate({ relay: confirm.relay, kind: confirm.kind });
    setConfirm(null);
  };

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 2,
          gap: 2,
        }}
      >
        <Typography variant="subtitle1">Reläer</Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setPairing(true)}
        >
          Koppla relä
        </Button>
      </Box>

      {isLoading && <div>Laddar…</div>}
      {isError && (
        <Typography color="error" variant="body2">
          Kunde inte ladda reläerna.
        </Typography>
      )}

      {data && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Namn</TableCell>
              <TableCell>Värdnamn</TableCell>
              <TableCell>Version</TableCell>
              <TableCell>Anslutning</TableCell>
              <TableCell>Senast sedd</TableCell>
              <TableCell align="right">Skrivare</TableCell>
              <TableCell align="right">Åtgärder</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography variant="body2" color="text.secondary">
                    Inga reläer kopplade ännu.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {data.map((relay) => {
              const isBusy = busy.has(relay.id);
              const offline = !relay.connected;
              return (
                <TableRow key={relay.id}>
                  <TableCell>{relay.name}</TableCell>
                  <TableCell>{relay.hostname ?? "—"}</TableCell>
                  <TableCell>
                    {relay.version ? (
                      <Tooltip title={relay.version}>
                        <Typography
                          variant="body2"
                          component="span"
                          sx={{ fontFamily: "monospace" }}
                        >
                          {relay.version.slice(0, 8)}
                        </Typography>
                      </Tooltip>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={relay.connected ? "Ansluten" : "Offline"}
                      color={relay.connected ? "success" : "default"}
                    />
                  </TableCell>
                  <TableCell>
                    <RelayRelativeTime date={relay.lastSeenAt} />
                  </TableCell>
                  <TableCell align="right">{relay.printers.length}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                    <Tooltip title="Byt namn">
                      <IconButton
                        size="small"
                        aria-label={`Byt namn på ${relay.name}`}
                        onClick={() => setRenaming(relay)}
                      >
                        <EditOutlined fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip
                      title={offline ? "Reläet är offline" : "Starta om"}
                    >
                      <span>
                        <IconButton
                          size="small"
                          aria-label={`Starta om ${relay.name}`}
                          disabled={offline || isBusy}
                          onClick={() => setConfirm({ kind: "reboot", relay })}
                        >
                          <RestartAlt fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={offline ? "Reläet är offline" : "Stäng av"}>
                      <span>
                        <IconButton
                          size="small"
                          aria-label={`Stäng av ${relay.name}`}
                          disabled={offline || isBusy}
                          onClick={() =>
                            setConfirm({ kind: "poweroff", relay })
                          }
                        >
                          <PowerSettingsNew fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Återkalla">
                      <IconButton
                        size="small"
                        color="error"
                        aria-label={`Återkalla ${relay.name}`}
                        onClick={() => setConfirm({ kind: "revoke", relay })}
                      >
                        <LinkOff fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {pairing && <PairRelayDialog onClose={() => setPairing(false)} />}
      {renaming && (
        <RelayRenameDialog relay={renaming} onClose={() => setRenaming(null)} />
      )}
      {confirm?.kind === "revoke" && (
        <RelayConfirmDialog
          title="Återkalla relä"
          body={
            <Typography>
              Återkalla <strong>{confirm.relay.name}</strong>? Reläet kopplas
              från och måste kopplas på nytt innan det kan skriva ut.
            </Typography>
          }
          confirmLabel="Återkalla"
          confirmColor="error"
          onConfirm={runConfirmed}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm && confirm.kind !== "revoke" && (
        <RelayConfirmDialog
          title={`${actionLabels[confirm.kind].verb} relä`}
          body={
            <Typography>
              {actionLabels[confirm.kind].verb}{" "}
              <strong>{confirm.relay.name}</strong>? Dess skrivare slutar
              fungera tills reläet är igång igen.
            </Typography>
          }
          confirmLabel={actionLabels[confirm.kind].verb}
          confirmColor="error"
          onConfirm={runConfirmed}
          onClose={() => setConfirm(null)}
        />
      )}
    </Box>
  );
}
