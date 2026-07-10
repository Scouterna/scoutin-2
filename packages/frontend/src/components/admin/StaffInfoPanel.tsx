import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/api";

type HistoryEntry = {
  sessionId: string;
  createdAt: string;
  completedAt: string | null;
  abortedAt: string | null;
};

type ParticipantContext = {
  id: string;
  firstName: string;
  lastName: string;
  subGroup: string | null;
  confirmedCheckedInAt: string | null;
  preliminaryCheckedInAt: string | null;
  importErrors: unknown;
  metadata: unknown;
  history: HistoryEntry[];
};

type SessionContext = {
  actor: ParticipantContext | null;
  group: { name: string; metadata: unknown; importErrors: unknown } | null;
  subjects: ParticipantContext[];
};

function hasEntries(value: unknown): value is Record<string, unknown> {
  return (
    value != null && typeof value === "object" && Object.keys(value).length > 0
  );
}

function ImportErrorsAlert({ importErrors }: { importErrors: unknown }) {
  if (!hasEntries(importErrors)) return null;
  return (
    <Alert severity="warning" sx={{ mb: 1 }}>
      <Typography variant="caption" component="div" sx={{ fontWeight: "bold" }}>
        Importfel
      </Typography>
      {Object.entries(importErrors).map(([source, reason]) => (
        <Typography key={source} variant="caption" component="div">
          {source}: {String(reason)}
        </Typography>
      ))}
    </Alert>
  );
}

function MetadataList({ metadata }: { metadata: unknown }) {
  if (!hasEntries(metadata)) return null;
  return (
    <Box sx={{ mb: 1 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block" }}
      >
        Metadata
      </Typography>
      {Object.entries(metadata).map(([key, value]) => (
        <Typography
          key={key}
          variant="caption"
          sx={{ display: "block", fontFamily: "monospace" }}
        >
          {key}: {JSON.stringify(value)}
        </Typography>
      ))}
    </Box>
  );
}

function historyLabel(entry: HistoryEntry) {
  if (entry.abortedAt) return "Avbruten";
  if (entry.completedAt) return "Slutförd";
  return "Pågick";
}

function HistoryList({ history }: { history: HistoryEntry[] }) {
  if (history.length === 0) return null;
  return (
    <Box sx={{ mb: 1 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block" }}
      >
        Tidigare incheckningar
      </Typography>
      {history.map((entry) => (
        <Typography
          key={entry.sessionId}
          variant="caption"
          sx={{ display: "block" }}
        >
          {new Date(entry.createdAt).toLocaleString()} — {historyLabel(entry)}
        </Typography>
      ))}
    </Box>
  );
}

function ParticipantCard({
  participant,
  roles,
}: {
  participant: ParticipantContext;
  roles: string[];
}) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2">
        {participant.firstName} {participant.lastName}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mb: 0.5 }}
      >
        {roles.join(" · ")}
        {participant.subGroup ? ` · ${participant.subGroup}` : ""}
      </Typography>
      <Box sx={{ display: "flex", gap: 0.5, mb: 1, flexWrap: "wrap" }}>
        {participant.confirmedCheckedInAt && (
          <Chip
            size="small"
            color="success"
            label={`Incheckad ${new Date(participant.confirmedCheckedInAt).toLocaleTimeString()}`}
          />
        )}
        {!participant.confirmedCheckedInAt &&
          participant.preliminaryCheckedInAt && (
            <Chip
              size="small"
              color="default"
              variant="outlined"
              label={`Preliminär ${new Date(participant.preliminaryCheckedInAt).toLocaleTimeString()}`}
            />
          )}
      </Box>
      <ImportErrorsAlert importErrors={participant.importErrors} />
      <MetadataList metadata={participant.metadata} />
      <HistoryList history={participant.history} />
    </Box>
  );
}

export function StaffInfoPanel({ sessionId }: { sessionId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "sessions", sessionId, "context"],
    queryFn: async () => {
      const res = await api.admin.sessions[":id"].context.$get({
        param: { id: sessionId },
      });
      if (!res.ok) throw new Error("Failed to load session context");
      return (await res.json()) as SessionContext;
    },
    refetchInterval: 2000,
  });

  if (isLoading) return null;
  if (isError || !data) {
    return <Alert severity="error">Kunde inte hämta extra info.</Alert>;
  }

  // The on-site self-check-in flow sets the actor as its own sole subject -
  // dedupe so the same person isn't shown twice with two role labels merged
  // into one, rather than as separate cards.
  const byId = new Map<
    string,
    { participant: ParticipantContext; roles: string[] }
  >();
  if (data.actor) {
    byId.set(data.actor.id, { participant: data.actor, roles: ["Aktör"] });
  }
  for (const subject of data.subjects) {
    const existing = byId.get(subject.id);
    if (existing) {
      existing.roles.push("Deltagare");
    } else {
      byId.set(subject.id, { participant: subject, roles: ["Deltagare"] });
    }
  }

  const entries = [...byId.values()];

  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>
        Extra info
      </Typography>

      {data.group && (
        <>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block" }}
          >
            Kår: {data.group.name}
          </Typography>
          <ImportErrorsAlert importErrors={data.group.importErrors} />
          <MetadataList metadata={data.group.metadata} />
          <Divider sx={{ my: 1 }} />
        </>
      )}

      {entries.length === 0 && (
        <Typography variant="caption" color="text.secondary">
          Ingen person identifierad än.
        </Typography>
      )}

      {entries.map(({ participant, roles }) => (
        <ParticipantCard
          key={participant.id}
          participant={participant}
          roles={roles}
        />
      ))}
    </Box>
  );
}
