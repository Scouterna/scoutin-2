import { createFileRoute } from "@tanstack/react-router";
import { assertAdmin } from "@/lib/user-context";
import { BlocklistManagement } from "../../components/admin/BlocklistManagement";

export const Route = createFileRoute("/admin/blocklist")({
  beforeLoad: ({ context }) => assertAdmin(context),
  component: () => <BlocklistManagement />,
});
