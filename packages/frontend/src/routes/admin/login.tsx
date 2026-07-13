import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/api/api";

export const Route = createFileRoute("/admin/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const mutation = useMutation({
    mutationFn: async (credentials: { username: string; password: string }) => {
      const res = await api.admin.auth.login.$post({ json: credentials });
      if (!res.ok) throw new Error("Invalid credentials");
    },
    onSuccess: () => {
      navigate({ to: "/admin" });
    },
  });

  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "60vh",
      }}
    >
      <Paper sx={{ p: 4, width: 360 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Logga in
        </Typography>
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate({ username, password });
          }}
          sx={{ display: "flex", flexDirection: "column", gap: 2 }}
        >
          <TextField
            label="Användarnamn"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <TextField
            label="Lösenord"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mutation.isError && (
            <Alert severity="error">Fel användarnamn eller lösenord</Alert>
          )}
          <Button
            type="submit"
            variant="contained"
            disabled={mutation.isPending || !username || !password}
          >
            Logga in
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
