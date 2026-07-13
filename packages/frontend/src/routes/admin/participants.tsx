import { createFileRoute } from "@tanstack/react-router";
import { ParticipantSearch } from "../../components/admin/ParticipantSearch";

export const Route = createFileRoute("/admin/participants")({
  component: () => <ParticipantSearch />,
});
