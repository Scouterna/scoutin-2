import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import { useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { queryClient } from "@/lib/queryClient";
import { adminPrintPoolIdAtom } from "@/store/adminPrintPool";
import { poolsQueryOptions } from "./PoolsQuery";

/**
 * Returns the stored print pool id to send when creating a session, or
 * undefined if none is stored or the stored pool no longer exists.
 */
export async function resolveAdminPrintPoolId(
  storedId: string | null,
): Promise<string | undefined> {
  if (!storedId) return undefined;
  const pools = await queryClient.ensureQueryData(poolsQueryOptions);
  return pools.some((pool) => pool.id === storedId) ? storedId : undefined;
}

export function PrintPoolSelect() {
  const [storedId, setStoredId] = useAtom(adminPrintPoolIdAtom);
  const poolsQuery = useQuery(poolsQueryOptions);
  const pools = poolsQuery.data ?? [];

  const value =
    storedId && pools.some((pool) => pool.id === storedId) ? storedId : "none";

  return (
    <FormControl size="small" sx={{ minWidth: 200 }}>
      <InputLabel id="admin-print-pool-label">Skrivarpool</InputLabel>
      <Select
        labelId="admin-print-pool-label"
        label="Skrivarpool"
        value={value}
        onChange={(e) =>
          setStoredId(e.target.value === "none" ? null : e.target.value)
        }
      >
        <MenuItem value="none">Ingen</MenuItem>
        {pools.map((pool) => (
          <MenuItem key={pool.id} value={pool.id}>
            {pool.name}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
