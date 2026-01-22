import { createFileRoute } from "@tanstack/react-router";
import { SessionTable } from "../../components/admin/SessionTable";

export const Route = createFileRoute("/admin/sessions")({
  component: RouteComponent,
});

function RouteComponent() {
  return <SessionTable />;
}
