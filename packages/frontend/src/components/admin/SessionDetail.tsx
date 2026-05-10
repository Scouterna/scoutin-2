import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/api";

export function SessionDetail({ sessionId }: { sessionId: string }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin", "sessions", sessionId],
    queryFn: async () => {
      const res = await api.admin.sessions[":id"].$get({
        param: { id: sessionId },
      });
      if (res.status === 404) throw new Error("Session not found");
      if (!res.ok) throw new Error(`Failed to load session (${res.status})`);
      return res.json();
    },
  });

  if (isLoading) return <div>Loading…</div>;
  if (!data)
    return (
      <div>
        {isError && error instanceof Error
          ? error.message
          : "Session not found."}
      </div>
    );

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
    </Box>
  );
}
