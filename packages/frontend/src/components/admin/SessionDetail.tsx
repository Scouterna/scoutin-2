import {
  Adjust,
  CheckCircle,
  RadioButtonUnchecked,
  RemoveCircleOutline,
} from "@mui/icons-material";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/api";

type StepStatus = "completed" | "active" | "skipped" | "pending";

function StatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "completed":
      return <CheckCircle sx={{ color: "success.main", fontSize: 22 }} />;
    case "active":
      return <Adjust sx={{ color: "primary.main", fontSize: 22 }} />;
    case "skipped":
      return (
        <RemoveCircleOutline sx={{ color: "text.disabled", fontSize: 22 }} />
      );
    case "pending":
      return (
        <RadioButtonUnchecked sx={{ color: "text.disabled", fontSize: 22 }} />
      );
  }
}

const statusLabel: Record<StepStatus, string> = {
  completed: "Completed",
  active: "Active",
  skipped: "Skipped",
  pending: "Pending",
};

const statusColor: Record<StepStatus, "success" | "primary" | "default"> = {
  completed: "success",
  active: "primary",
  skipped: "default",
  pending: "default",
};

export function SessionDetail({ sessionId }: { sessionId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "sessions", sessionId],
    queryFn: async () => {
      const res = await api.admin.sessions[":id"].$get({
        param: { id: sessionId },
      });
      if (!res.ok) throw new Error("Session not found");
      return res.json();
    },
  });

  if (isLoading) return <div>Loading…</div>;
  if (isError || !data) return <div>Session not found.</div>;

  const actorName =
    data.actor?.firstName && data.actor?.lastName
      ? `${data.actor.firstName} ${data.actor.lastName}`
      : "Unknown";

  return (
    <Box sx={{ maxWidth: 700 }}>
      {/* Session info */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h6" gutterBottom>
          Session
        </Typography>
        <Typography variant="body2" color="text.secondary">
          <strong>ID:</strong> <code>{data.id}</code>
        </Typography>
        <Typography variant="body2" color="text.secondary">
          <strong>Created:</strong> {new Date(data.createdAt).toLocaleString()}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          <strong>Actor:</strong> {actorName}
        </Typography>
        {data.subjects.length > 0 && (
          <Typography variant="body2" color="text.secondary">
            <strong>Subjects:</strong>{" "}
            {data.subjects
              .map((s) => `${s.firstName} ${s.lastName}`)
              .join(", ")}
          </Typography>
        )}
      </Box>

      {/* Step timeline */}
      <Typography variant="h6" gutterBottom>
        Steps
      </Typography>
      <Box>
        {data.stepStatuses.map((step, index) => {
          const status = step.status;
          const isLast = index === data.stepStatuses.length - 1;

          return (
            <Box key={step.uses} sx={{ display: "flex", gap: 2 }}>
              {/* Icon + connector line */}
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  minWidth: 22,
                }}
              >
                <StatusIcon status={status} />
                {!isLast && (
                  <Box
                    sx={{
                      width: "2px",
                      flexGrow: 1,
                      bgcolor: "divider",
                      my: "4px",
                    }}
                  />
                )}
              </Box>

              {/* Step content */}
              <Box sx={{ pb: isLast ? 0 : 3, flexGrow: 1, minWidth: 0 }}>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    mb: 0.5,
                  }}
                >
                  <Typography
                    variant="body2"
                    fontWeight="medium"
                    color={status === "skipped" ? "text.disabled" : "text.primary"}
                  >
                    {step.uses}
                  </Typography>
                  <Chip
                    label={statusLabel[status]}
                    color={statusColor[status]}
                    size="small"
                    variant="outlined"
                  />
                </Box>

                {step.if && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    sx={{ fontFamily: "monospace", mb: 0.5 }}
                  >
                    if: {step.if}
                  </Typography>
                )}

                {step.completedAt && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                  >
                    {new Date(step.completedAt).toLocaleString()}
                  </Typography>
                )}

                {step.outputs && Object.keys(step.outputs).length > 0 && (
                  <details style={{ marginTop: 4 }}>
                    <summary
                      style={{ cursor: "pointer", fontSize: 12, color: "gray" }}
                    >
                      Outputs
                    </summary>
                    <pre
                      style={{
                        fontSize: 11,
                        background: "#f5f5f5",
                        padding: "8px",
                        borderRadius: 4,
                        overflow: "auto",
                        marginTop: 4,
                      }}
                    >
                      {JSON.stringify(step.outputs, null, 2)}
                    </pre>
                  </details>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
