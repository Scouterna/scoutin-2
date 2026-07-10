import { createFileRoute } from "@tanstack/react-router";
import { api } from "@/api/api";
import { queryClient } from "@/lib/queryClient";
import { RosterReport } from "../../components/admin/RosterReport";

const rosterQuery = {
  queryKey: ["admin", "reports", "roster", "sv"],
  queryFn: async () => {
    const res = await api.admin.reports.roster.$get({
      query: { locale: "sv" },
    });
    return res.json();
  },
};

export const Route = createFileRoute("/admin/reports")({
  loader: () => queryClient.ensureQueryData(rosterQuery),
  component: () => <RosterReport />,
});
