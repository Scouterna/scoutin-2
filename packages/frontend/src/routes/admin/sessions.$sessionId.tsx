import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import Button from "@mui/material/Button";
import { createFileRoute, Link } from "@tanstack/react-router";
import { SessionDetail } from "../../components/admin/SessionDetail";

export const Route = createFileRoute("/admin/sessions/$sessionId")({
  component: SessionPage,
});

function SessionPage() {
  const { sessionId } = Route.useParams();

  return (
    <div>
      <Link to="/admin/sessions">
        <Button startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>
          All sessions
        </Button>
      </Link>

      <SessionDetail sessionId={sessionId} />
    </div>
  );
}
