import type { Listeners, MessageTypes } from "@scouterna/scoutin-backend";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/api/api";
import type { TypedSocket } from "@/api/typedSocket";

type LogEntry = {
  ts: Date;
  direction: "in" | "out";
  name: string;
  data?: unknown;
};

type Props = {
  sessionId: string;
  socket: TypedSocket<Listeners, MessageTypes>;
  messageLog: LogEntry[];
  currentScreenId: string | null;
};

export { type LogEntry };

export function AdminDebugPanel({
  sessionId,
  socket,
  messageLog,
  currentScreenId,
}: Props) {
  const [methodName, setMethodName] = useState("");
  const [methodInputs, setMethodInputs] = useState("{}");
  const [inputsError, setInputsError] = useState<string | null>(null);

  const { data: sessionData, refetch } = useQuery({
    queryKey: ["admin", "sessions", sessionId],
    queryFn: async () => {
      const res = await api.admin.sessions[":id"].$get({
        param: { id: sessionId },
      });
      if (!res.ok) throw new Error("Failed to load session");
      return res.json();
    },
    refetchInterval: 2000,
  });

  const sendGoBack = () => {
    socket.send({ name: "step:goBack" });
    refetch();
  };

  const sendMethod = () => {
    let inputs: Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(methodInputs);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        inputs = parsed as Record<string, unknown>;
      } else {
        setInputsError("Must be a JSON object");
        return;
      }
    } catch {
      setInputsError("Invalid JSON");
      return;
    }

    setInputsError(null);
    socket.send({
      name: "step:callMethod",
      data: {
        name: methodName,
        inputs,
      },
    });
    refetch();
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Session info */}
      <Box>
        <Typography variant="subtitle2" gutterBottom>
          Session
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block">
          <code>{sessionId}</code>
        </Typography>
        {sessionData?.actor && (
          <Typography variant="caption" color="text.secondary" display="block">
            Actor: {sessionData.actor.firstName} {sessionData.actor.lastName}
          </Typography>
        )}
        {sessionData && sessionData.subjects.length > 0 && (
          <Typography variant="caption" color="text.secondary" display="block">
            Subjects:{" "}
            {sessionData.subjects
              .map((s) => `${s.firstName} ${s.lastName}`)
              .join(", ")}
          </Typography>
        )}
        {currentScreenId && (
          <Typography variant="caption" color="text.secondary" display="block">
            Screen: <code>{currentScreenId}</code>
          </Typography>
        )}
      </Box>

      <Divider />

      {/* Step status */}
      {sessionData && (
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Steps
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
            {sessionData.stepStatuses.map((step) => (
              <Box
                key={step.uses}
                sx={{ display: "flex", alignItems: "center", gap: 1 }}
              >
                <Chip
                  label={step.status}
                  size="small"
                  color={
                    step.status === "active"
                      ? "primary"
                      : step.status === "completed"
                        ? "success"
                        : "default"
                  }
                  variant="outlined"
                  sx={{ minWidth: 80 }}
                />
                <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                  {step.uses}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      <Divider />

      {/* Controls */}
      <Box>
        <Typography variant="subtitle2" gutterBottom>
          Controls
        </Typography>
        <Button size="small" variant="outlined" onClick={sendGoBack}>
          Go back
        </Button>
      </Box>

      <Divider />

      {/* Method invocation */}
      <Box>
        <Typography variant="subtitle2" gutterBottom>
          Call method
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <TextField
            size="small"
            label="Method name"
            value={methodName}
            onChange={(e) => setMethodName(e.target.value)}
            placeholder="e.g. searchByString"
          />
          <TextField
            size="small"
            label="Inputs (JSON)"
            value={methodInputs}
            onChange={(e) => {
              setMethodInputs(e.target.value);
              setInputsError(null);
            }}
            multiline
            rows={3}
            error={Boolean(inputsError)}
            helperText={inputsError}
            InputProps={{ sx: { fontFamily: "monospace", fontSize: 12 } }}
          />
          <Button
            size="small"
            variant="contained"
            disabled={!methodName.trim()}
            onClick={sendMethod}
          >
            Send
          </Button>
        </Box>
      </Box>

      <Divider />

      {/* Message log */}
      <Box sx={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <Typography variant="subtitle2" gutterBottom>
          Message log
        </Typography>
        <Box
          sx={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 0.5,
          }}
        >
          {messageLog.length === 0 && (
            <Typography variant="caption" color="text.secondary">
              No messages yet
            </Typography>
          )}
          {messageLog.map((entry, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: log entries have no stable id
            <Box key={i} sx={{ fontFamily: "monospace", fontSize: 11 }}>
              <Typography
                component="span"
                sx={{
                  fontSize: 11,
                  color: entry.direction === "in" ? "primary.main" : "text.secondary",
                  mr: 0.5,
                }}
              >
                {entry.direction === "in" ? "←" : "→"}
              </Typography>
              <Typography component="span" sx={{ fontSize: 11, fontWeight: "bold" }}>
                {entry.name}
              </Typography>
              {entry.data !== undefined && (
                <Typography
                  component="pre"
                  sx={{
                    fontSize: 10,
                    m: 0,
                    pl: 1.5,
                    color: "text.secondary",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                  }}
                >
                  {JSON.stringify(entry.data, null, 2)}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
