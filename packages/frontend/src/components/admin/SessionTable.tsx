import Button from "@mui/material/Button";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { api } from "@/api/api";

type SessionRow = {
  id: string;
  createdAt: string;
  actorName?: string;
};

const columnHelper = createColumnHelper<SessionRow>();

const columns = [
  columnHelper.accessor("actorName", {
    header: "Actor",
    cell: (info) => info.getValue() ?? "—",
  }),
  columnHelper.accessor("createdAt", {
    header: "Created",
    cell: (info) => new Date(info.getValue()).toLocaleString(),
  }),
  columnHelper.accessor("id", {
    header: "ID",
    cell: (info) => (
      <code style={{ fontSize: 12 }}>{info.getValue().slice(0, 8)}…</code>
    ),
  }),
  columnHelper.display({
    id: "actions",
    cell: (props) => (
      <Link
        to="/admin/sessions/$sessionId"
        params={{ sessionId: props.row.original.id }}
      >
        <Button size="small">View</Button>
      </Link>
    ),
  }),
];

export function SessionTable() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "sessions"],
    queryFn: async () => {
      const res = await api.admin.sessions.$get();
      return res.json();
    },
  });

  const table = useReactTable({
    data: (data?.sessions as SessionRow[]) ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const { rows } = table.getRowModel();

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 53,
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 10,
  });

  if (isLoading) return <div>Loading…</div>;
  if (isError) return <div>Failed to load sessions.</div>;

  const virtualRows = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();
  const paddingTop = virtualRows[0]?.start ?? 0;
  const paddingBottom =
    totalHeight - (virtualRows[virtualRows.length - 1]?.end ?? 0);

  return (
    <TableContainer
      ref={scrollRef}
      sx={{ maxHeight: "calc(100vh - 128px)", overflow: "auto" }}
    >
      <Table stickyHeader>
        <TableHead>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableCell key={header.id}>
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext(),
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableHead>
        <TableBody>
          {paddingTop > 0 && (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                sx={{ height: paddingTop, p: 0, border: 0 }}
              />
            </TableRow>
          )}
          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
            return (
              <TableRow
                key={row.id}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
          {paddingBottom > 0 && (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                sx={{ height: paddingBottom, p: 0, border: 0 }}
              />
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
