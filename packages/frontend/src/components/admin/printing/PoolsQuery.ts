import { queryOptions } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { api } from "@/api/api";

export const poolsQueryKey = ["admin", "printing", "pools"] as const;

export const poolsQueryOptions = queryOptions({
  queryKey: poolsQueryKey,
  queryFn: async () => {
    const res = await api.admin.printing.pools.$get();
    if (!res.ok) throw new Error("Kunde inte ladda skrivarpoolerna");
    return (await res.json()).pools;
  },
});

export type Pool = InferResponseType<
  typeof api.admin.printing.pools.$get
>["pools"][number];
