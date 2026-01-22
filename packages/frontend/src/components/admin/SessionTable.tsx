import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";

type SessionInfo = {
  id: string;
};

const data: SessionInfo[] = [
  {
    id: "f06fc2b3-900f-458f-8bb3-bb0259c6a13e",
  },
  {
    id: "d35ad348-3bed-4fc9-8c36-dcdbb1141a2b",
  },
];

const columnHelper = createColumnHelper<SessionInfo>();

const columns = [
  // Display Column
  columnHelper.display({
    id: "actions",
    // cell: (props) => <RowActions row={props.row} />,
    cell: (props) => <div>Actions</div>,
  }),
  // Accessor Column
  columnHelper.accessor("id", {
    header: "Session ID",
    cell: (info) => info.getValue(),
    footer: (props) => props.column.id,
  }),
];

export function SessionTable() {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <TableContainer>
      <Table>
        <TableHead>
          {table.getHeaderGroups().map((headerGroup) => {
            return (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map(
                  (
                    header, // map over the headerGroup headers array
                  ) => (
                    <TableCell key={header.id} colSpan={header.colSpan}>
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                    </TableCell>
                  ),
                )}
              </TableRow>
            );
          })}
        </TableHead>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => {
                return (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
