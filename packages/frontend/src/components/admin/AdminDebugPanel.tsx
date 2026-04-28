import {
  Adjust,
  CheckCircle,
  RadioButtonUnchecked,
  RemoveCircleOutline,
} from "@mui/icons-material";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import type { Listeners, MessageTypes } from "@scouterna/scoutin-backend";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/api";
import type { TypedSocket } from "@/api/typedSocket";

type Props = {
  sessionId: string;
  socket: TypedSocket<Listeners, MessageTypes> | null;
  currentScreenId: string | null;
};

export function AdminDebugPanel({ sessionId, socket, currentScreenId }: Props) {
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
    socket?.send({ name: "step:goBack" });
    refetch();
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
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

      {/* Step timeline */}
      {sessionData && (
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Steps
          </Typography>
          {sessionData.stepStatuses.map((step, index) => {
            const status = step.status as "completed" | "active" | "skipped" | "pending";
            const isLast = index === sessionData.stepStatuses.length - 1;
            const statusColor: Record<typeof status, "success" | "primary" | "default"> = {
              completed: "success",
              active: "primary",
              skipped: "default",
              pending: "default",
            };
            const StatusIcon = () => {
              switch (status) {
                case "completed": return <CheckCircle sx={{ color: "success.main", fontSize: 18 }} />;
                case "active": return <Adjust sx={{ color: "primary.main", fontSize: 18 }} />;
                case "skipped": return <RemoveCircleOutline sx={{ color: "text.disabled", fontSize: 18 }} />;
                case "pending": return <RadioButtonUnchecked sx={{ color: "text.disabled", fontSize: 18 }} />;
              }
            };
            return (
              <Box key={step.uses} sx={{ display: "flex", gap: 1 }}>
                <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 18 }}>
                  <StatusIcon />
                  {!isLast && (
                    <Box sx={{ width: "2px", flexGrow: 1, bgcolor: "divider", my: "3px" }} />
                  )}
                </Box>
                <Box sx={{ pb: isLast ? 0 : 2, flexGrow: 1, minWidth: 0 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.25, flexWrap: "wrap" }}>
                    <Typography
                      variant="caption"
                      sx={{ fontFamily: "monospace", color: status === "skipped" ? "text.disabled" : "text.primary" }}
                    >
                      {step.uses}
                    </Typography>
                    <Chip label={status} color={statusColor[status]} size="small" variant="outlined" />
                  </Box>
                  {step.if && (
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ fontFamily: "monospace" }}>
                      if: {step.if}
                    </Typography>
                  )}
                  {step.completedAt && (
                    <Typography variant="caption" color="text.secondary" display="block">
                      {new Date(step.completedAt).toLocaleString()}
                    </Typography>
                  )}
                  {step.outputs && Object.keys(step.outputs).length > 0 && (
                    <details style={{ marginTop: 2 }}>
                      <summary style={{ cursor: "pointer", fontSize: 11, color: "gray" }}>Outputs</summary>
                      <pre style={{ fontSize: 10, background: "#f5f5f5", padding: "6px", borderRadius: 4, overflow: "auto", marginTop: 2 }}>
                        {JSON.stringify(step.outputs, null, 2)}
                      </pre>
                    </details>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      <Divider />

      {/* Controls */}
      <Box>
        <Typography variant="subtitle2" gutterBottom>
          Controls
        </Typography>
        <Button size="small" variant="outlined" onClick={sendGoBack} disabled={!socket}>
          Go back
        </Button>
      </Box>
    </Box>
  );
}
