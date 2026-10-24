import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/api";

/** How many print jobs are `unknown` and waiting for staff to settle them. */
export function useUnknownJobCount(): number {
  const { data } = useQuery({
    queryKey: ["admin", "printing", "jobs", "unknown-count"],
    queryFn: async () => {
      const res = await api.admin.printing.jobs.$get({
        query: { state: "unknown" },
      });
      if (!res.ok) throw new Error("Kunde inte ladda jobb");
      return (await res.json()).jobs.length;
    },
    refetchInterval: 5000,
  });
  return data ?? 0;
}
