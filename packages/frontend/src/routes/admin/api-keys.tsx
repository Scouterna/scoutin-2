import Add from "@mui/icons-material/Add";
import BlockIcon from "@mui/icons-material/Block";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import EditOutlined from "@mui/icons-material/EditOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { InferRequestType, InferResponseType } from "hono/client";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/api";
import { copyText } from "@/lib/clipboard";
import { queryClient } from "@/lib/queryClient";
import { assertAdmin } from "@/lib/user-context";

type ApiKeysClient = (typeof api.admin)["api-keys"];
type CreateBody = InferRequestType<ApiKeysClient["$post"]>["json"];
type ApiPermission = CreateBody["permissions"][number];
type ApiKeysResponse = InferResponseType<ApiKeysClient["$get"]>;
type ApiKey = ApiKeysResponse["apiKeys"][number];

export const Route = createFileRoute("/admin/api-keys")({
  beforeLoad: ({ context }) => assertAdmin(context),
  component: ApiKeysPage,
});

const apiKeysQueryKey = ["admin", "api-keys"];
const permissionsQueryKey = ["admin", "api-key-permissions"];

/** Throw with the server's error message when a response isn't ok. */
async function assertOk(res: Response): Promise<void> {
  if (res.ok) return;
  let message = "Något gick fel";
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // keep the fallback
  }
  throw new Error(message);
}

const permissionsQuery = {
  queryKey: permissionsQueryKey,
  queryFn: async () => {
    const res = await api.admin["api-keys"].permissions.$get();
    await assertOk(res as Response);
    return (await res.json()).permissions;
  },
};

const invalidateApiKeys = () =>
  queryClient.invalidateQueries({ queryKey: apiKeysQueryKey });

/** One checkbox per permission. Labels come from the server. */
function PermissionCheckboxes({
  value,
  onChange,
}: {
  value: ApiPermission[];
  onChange: (next: ApiPermission[]) => void;
}) {
  const permissionsQueryResult = useQuery(permissionsQuery);

  return (
    <FormGroup>
      {permissionsQueryResult.data?.map((p) => (
        <FormControlLabel
          key={p.permission}
          label={p.label}
          control={
            <Checkbox
              checked={value.includes(p.permission as ApiPermission)}
              onChange={(e) => {
                const permission = p.permission as ApiPermission;
                onChange(
                  e.target.checked
                    ? [...value, permission]
                    : value.filter((item) => item !== permission),
                );
              }}
            />
          }
        />
      ))}
    </FormGroup>
  );
}

function CreateApiKeyDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (key: string) => void;
}) {
  const [name, setName] = useState("");
  const [permissions, setPermissions] = useState<ApiPermission[]>([]);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await api.admin["api-keys"].$post({
        json: { name: name.trim(), permissions },
      });
      await assertOk(res as Response);
      return (await res.json()).key;
    },
    onSuccess: (key) => {
      invalidateApiKeys();
      onCreated(key);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Skapa API-nyckel</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          label="Namn"
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ mt: 1, mb: 2 }}
        />
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Behörigheter
        </Typography>
        <PermissionCheckboxes value={permissions} onChange={setPermissions} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Avbryt</Button>
        <Button
          variant="contained"
          onClick={() => mutation.mutate()}
          disabled={
            !name.trim() || permissions.length === 0 || mutation.isPending
          }
        >
          Skapa
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Shows the new key once. Only the close button dismisses it: a stray backdrop
 * click or Escape would lose the key for good.
 */
function ApiKeyShownDialog({
  apiKeyValue,
  onClose,
}: {
  apiKeyValue: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!(await copyText(apiKeyValue))) {
      toast.error(
        "Kunde inte kopiera. Markera nyckeln och kopiera den manuellt.",
      );
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog open maxWidth="sm" fullWidth>
      <DialogTitle>API-nyckel skapad</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Du kommer inte att se nyckeln igen. Spara den nu.
        </Alert>
        <Typography
          sx={{
            p: 2,
            bgcolor: "grey.100",
            borderRadius: 1,
            fontFamily: "monospace",
            wordBreak: "break-all",
          }}
        >
          {apiKeyValue}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button startIcon={<ContentCopyIcon />} onClick={handleCopy}>
          {copied ? "Kopierad" : "Kopiera"}
        </Button>
        <Button variant="contained" onClick={onClose}>
          Klar
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function EditApiKeyDialog({
  apiKey,
  onClose,
}: {
  apiKey: ApiKey;
  onClose: () => void;
}) {
  const [name, setName] = useState(apiKey.name);
  const [permissions, setPermissions] = useState<ApiPermission[]>(
    apiKey.permissions as ApiPermission[],
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await api.admin["api-keys"][":id"].$patch({
        param: { id: apiKey.id },
        json: { name: name.trim(), permissions },
      });
      await assertOk(res as Response);
    },
    onSuccess: () => {
      invalidateApiKeys();
      toast.success("API-nyckel uppdaterad");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Redigera API-nyckel</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          label="Namn"
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ mt: 1, mb: 2 }}
        />
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Behörigheter
        </Typography>
        <PermissionCheckboxes value={permissions} onChange={setPermissions} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Avbryt</Button>
        <Button
          variant="contained"
          onClick={() => mutation.mutate()}
          disabled={
            !name.trim() || permissions.length === 0 || mutation.isPending
          }
        >
          Spara
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function RevokeApiKeyDialog({
  apiKey,
  onClose,
}: {
  apiKey: ApiKey;
  onClose: () => void;
}) {
  const mutation = useMutation({
    mutationFn: async () => {
      const res = await api.admin["api-keys"][":id"].revoke.$post({
        param: { id: apiKey.id },
      });
      await assertOk(res as Response);
    },
    onSuccess: () => {
      invalidateApiKeys();
      toast.success("API-nyckel återkallad");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Återkalla API-nyckel</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Återkalla nyckeln? Integrationer som använder den slutar fungera
          direkt.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Avbryt</Button>
        <Button
          color="error"
          variant="contained"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          Återkalla
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ApiKeysPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<ApiKey | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);

  const apiKeysQuery = useQuery({
    queryKey: apiKeysQueryKey,
    queryFn: async () => {
      const res = await api.admin["api-keys"].$get();
      await assertOk(res as Response);
      return (await res.json()).apiKeys;
    },
  });

  const permissionsQueryResult = useQuery(permissionsQuery);
  const labelFor = (permission: string) =>
    permissionsQueryResult.data?.find((p) => p.permission === permission)
      ?.label ?? permission;

  return (
    <Box sx={{ maxWidth: 1100 }}>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
        }}
      >
        <Typography variant="h5">API-nycklar</Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setCreateOpen(true)}
        >
          Skapa API-nyckel
        </Button>
      </Box>

      <Paper>
        {apiKeysQuery.isLoading ? (
          <div>Laddar…</div>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Namn</TableCell>
                <TableCell>Nyckel</TableCell>
                <TableCell>Behörigheter</TableCell>
                <TableCell>Skapad av</TableCell>
                <TableCell>Skapad</TableCell>
                <TableCell>Senast använd</TableCell>
                <TableCell>Status</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {apiKeysQuery.data?.map((apiKey) => {
                const revoked = apiKey.revokedAt !== null;
                return (
                  <TableRow
                    key={apiKey.id}
                    sx={revoked ? { opacity: 0.5 } : undefined}
                  >
                    <TableCell>{apiKey.name}</TableCell>
                    <TableCell sx={{ fontFamily: "monospace" }}>
                      {apiKey.prefix}…
                    </TableCell>
                    <TableCell>
                      {apiKey.permissions.map(labelFor).join(", ")}
                    </TableCell>
                    <TableCell>{apiKey.createdBy}</TableCell>
                    <TableCell>
                      {new Date(apiKey.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {apiKey.lastUsedAt
                        ? new Date(apiKey.lastUsedAt).toLocaleString()
                        : "Aldrig"}
                    </TableCell>
                    <TableCell>
                      {apiKey.revokedAt
                        ? `Återkallad ${new Date(apiKey.revokedAt).toLocaleString()}`
                        : "Aktiv"}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                      {!revoked && (
                        <>
                          <IconButton
                            size="small"
                            title="Redigera"
                            onClick={() => setEditing(apiKey)}
                          >
                            <EditOutlined fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            color="error"
                            title="Återkalla"
                            onClick={() => setRevoking(apiKey)}
                          >
                            <BlockIcon fontSize="small" />
                          </IconButton>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Paper>

      {createOpen && (
        <CreateApiKeyDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(key) => {
            setCreateOpen(false);
            setCreatedKey(key);
          }}
        />
      )}
      {createdKey && (
        <ApiKeyShownDialog
          apiKeyValue={createdKey}
          onClose={() => setCreatedKey(null)}
        />
      )}
      {editing && (
        <EditApiKeyDialog apiKey={editing} onClose={() => setEditing(null)} />
      )}
      {revoking && (
        <RevokeApiKeyDialog
          apiKey={revoking}
          onClose={() => setRevoking(null)}
        />
      )}
    </Box>
  );
}
