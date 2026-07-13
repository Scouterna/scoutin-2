import { Delete as DeleteIcon, Key as KeyIcon } from "@mui/icons-material";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/api";
import { queryClient } from "@/lib/queryClient";
import { assertAdmin, useUser } from "@/lib/user-context";

export const Route = createFileRoute("/admin/users")({
  beforeLoad: ({ context }) => assertAdmin(context),
  component: UsersPage,
});

const usersQueryKey = ["admin", "users"];

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

function UsersPage() {
  const currentUser = useUser();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // Off = operator (check-in access), on = admin (full access). Default to the
  // least-privileged role.
  const [isAdmin, setIsAdmin] = useState(false);

  const usersQuery = useQuery({
    queryKey: usersQueryKey,
    queryFn: async () => {
      const res = await api.admin.users.$get();
      await assertOk(res as Response);
      return (await res.json()).users;
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: usersQueryKey });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await api.admin.users.$post({
        json: {
          username,
          password,
          roles: isAdmin ? ["admin"] : ["operator"],
        },
      });
      await assertOk(res as Response);
    },
    onSuccess: () => {
      setUsername("");
      setPassword("");
      setIsAdmin(false);
      invalidate();
      toast.success("Användare skapad");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.admin.users[":id"].$delete({ param: { id } });
      await assertOk(res as Response);
    },
    onSuccess: () => {
      invalidate();
      toast.success("Användare borttagen");
    },
    onError: (e) => toast.error(e.message),
  });

  const roleMutation = useMutation({
    mutationFn: async (input: { id: string; roles: string[] }) => {
      const res = await api.admin.users[":id"].$patch({
        param: { id: input.id },
        json: { roles: input.roles },
      });
      await assertOk(res as Response);
    },
    onSuccess: invalidate,
    onError: (e) => toast.error(e.message),
  });

  const passwordMutation = useMutation({
    mutationFn: async (input: { id: string; password: string }) => {
      const res = await api.admin.users[":id"].password.$post({
        param: { id: input.id },
        json: { password: input.password },
      });
      await assertOk(res as Response);
    },
    onSuccess: () => toast.success("Lösenord återställt"),
    onError: (e) => toast.error(e.message),
  });

  const resetPassword = (id: string, username: string) => {
    const next = window.prompt(`Nytt lösenord för ${username}`);
    if (next) passwordMutation.mutate({ id, password: next });
  };

  return (
    <Box sx={{ maxWidth: 900 }}>
      <Typography variant="h5" sx={{ mb: 3 }}>
        Användare
      </Typography>

      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="subtitle1" sx={{ mb: 2 }}>
          Skapa användare
        </Typography>
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
        >
          <Box
            sx={{
              display: "flex",
              flexDirection: { xs: "column", sm: "row" },
              gap: 2,
              alignItems: "center",
            }}
          >
            <TextField
              label="Användarnamn"
              size="small"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <TextField
              label="Lösenord"
              type="password"
              size="small"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={isAdmin}
                  onChange={(e) => setIsAdmin(e.target.checked)}
                />
              }
              label="Admin"
            />
            <Button
              type="submit"
              variant="contained"
              disabled={createMutation.isPending || !username || !password}
            >
              Skapa
            </Button>
          </Box>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mt: 1 }}
          >
            Av = operatör (incheckning & rapporter). På = admin (full åtkomst).
          </Typography>
        </Box>
      </Paper>

      <Paper>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Användarnamn</TableCell>
              <TableCell>Admin</TableCell>
              <TableCell align="right">Åtgärder</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {usersQuery.data?.map((u) => {
              const isSelf = u.id === currentUser.sub;
              const admin = u.roles.includes("admin");
              return (
                <TableRow key={u.id}>
                  <TableCell>
                    {u.username}
                    {isSelf && <Chip label="Du" size="small" sx={{ ml: 1 }} />}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={admin}
                      onChange={(e) =>
                        roleMutation.mutate({
                          id: u.id,
                          roles: e.target.checked ? ["admin"] : ["operator"],
                        })
                      }
                    />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      title="Återställ lösenord"
                      onClick={() => resetPassword(u.id, u.username)}
                    >
                      <KeyIcon />
                    </IconButton>
                    <IconButton
                      title="Ta bort"
                      color="error"
                      onClick={() => {
                        if (window.confirm(`Ta bort ${u.username}?`)) {
                          deleteMutation.mutate(u.id);
                        }
                      }}
                    >
                      <DeleteIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}
