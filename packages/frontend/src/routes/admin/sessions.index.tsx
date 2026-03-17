import { createFileRoute } from "@tanstack/react-router";
import { api } from "@/api/api";
import { queryClient } from "@/lib/queryClient";
import { SessionTable } from "../../components/admin/SessionTable";

const sessionsQuery = {
  queryKey: ["admin", "sessions"],
  queryFn: async () => {
    const res = await api.admin.sessions.$get();
    return res.json();
  },
};

export const Route = createFileRoute("/admin/sessions/")({
  loader: () => queryClient.ensureQueryData(sessionsQuery),
  component: () => <SessionTable />,
});
