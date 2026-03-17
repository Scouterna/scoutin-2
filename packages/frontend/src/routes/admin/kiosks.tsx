import Add from "@mui/icons-material/Add";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function timeAgo(date: string): string {
  const seconds = Math.round((new Date(date).getTime() - Date.now()) / 1000);
  const cutoffs: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [604800, "day"],
    [2592000, "week"],
    [Infinity, "month"],
  ];
  for (const [limit, unit] of cutoffs) {
    if (Math.abs(seconds) < limit) {
      const divisors: Record<string, number> = {
        second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000,
      };
      return rtf.format(Math.round(seconds / divisors[unit]), unit);
    }
  }
  return rtf.format(Math.round(seconds / 2592000), "month");
}
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/api/api";
import { AddKioskDialog } from "../../components/admin/AddKioskDialog";

export const Route = createFileRoute("/admin/kiosks")({
  component: KiosksPage,
});

function KiosksPage() {
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "kiosks"],
    queryFn: async () => {
      const res = await api.admin.kiosks.$get();
      return res.json();
    },
  });

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 3,
        }}
      >
        <Typography variant="h5">Kiosks</Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setDialogOpen(true)}
        >
          Add kiosk
        </Button>
      </Box>

      {isLoading ? (
        <div>Loading…</div>
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Last seen</TableCell>
              <TableCell>Added</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data?.kiosks.map((kiosk) => (
              <TableRow key={kiosk.id}>
                <TableCell>{kiosk.name}</TableCell>
                <TableCell>
                  {kiosk.lastSeenAt ? timeAgo(kiosk.lastSeenAt) : "Never"}
                </TableCell>
                <TableCell>
                  {new Date(kiosk.createdAt).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <AddKioskDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </Box>
  );
}
