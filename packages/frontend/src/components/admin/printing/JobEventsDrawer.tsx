import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Drawer from "@mui/material/Drawer";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/api";
import { JobStateChip } from "./JobStateChip";

export function JobEventsDrawer({
  jobId,
  onClose,
}: {
  jobId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "printing", "jobs", "detail", jobId],
    enabled: jobId !== null,
    queryFn: async () => {
      if (!jobId) throw new Error("Inget jobb");
      const res = await api.admin.printing.jobs[":id"].$get({
        param: { id: jobId },
      });
      if (!res.ok) throw new Error("Kunde inte ladda jobbet");
      return await res.json();
    },
    refetchInterval: 5000,
  });

  return (
    <Drawer anchor="right" open={jobId !== null} onClose={onClose}>
      <Box sx={{ width: { xs: "100vw", sm: 560 }, p: 3 }}>
        <Typography variant="h6" gutterBottom>
          Jobbhistorik
        </Typography>
        {isLoading && <CircularProgress size={24} />}
        {isError && <Alert severity="error">Kunde inte ladda jobbet.</Alert>}
        {data && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {data.template} · {data.id}
            </Typography>
            {data.failureReason && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {data.failureReason}
              </Alert>
            )}
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Tid</TableCell>
                  <TableCell>Ändring</TableCell>
                  <TableCell>Orsak</TableCell>
                  <TableCell>Utförd av</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      {new Date(e.at).toLocaleString("sv-SE")}
                    </TableCell>
                    <TableCell>
                      <Box
                        sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
                      >
                        {e.from ? <JobStateChip state={e.from} /> : "–"}
                        {"→"}
                        <JobStateChip state={e.to} />
                      </Box>
                    </TableCell>
                    <TableCell>{e.reason ?? ""}</TableCell>
                    <TableCell>{e.actor ?? ""}</TableCell>
                  </TableRow>
                ))}
                {data.events.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4}>Inga händelser.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </>
        )}
      </Box>
    </Drawer>
  );
}
