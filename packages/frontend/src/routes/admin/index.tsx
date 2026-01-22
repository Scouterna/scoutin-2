import Button from "@mui/material/Button";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div>
      Hello "/admin/"!
      <Button variant="contained">Hello world</Button>
      <div className="bg-red-500">This should not be red</div>
    </div>
  );
}
