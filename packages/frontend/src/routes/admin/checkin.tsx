import { createFileRoute } from "@tanstack/react-router";
import { StaffCheckin } from "../../components/admin/StaffCheckin";

export const Route = createFileRoute("/admin/checkin")({
  component: () => <StaffCheckin />,
});
