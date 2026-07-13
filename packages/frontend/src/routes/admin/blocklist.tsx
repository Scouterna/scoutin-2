import { createFileRoute } from "@tanstack/react-router";
import { BlocklistManagement } from "../../components/admin/BlocklistManagement";

export const Route = createFileRoute("/admin/blocklist")({
  component: () => <BlocklistManagement />,
});
