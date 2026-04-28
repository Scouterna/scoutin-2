import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AdminSessionOverview } from "../../components/admin/AdminSessionOverview";
import { SessionDetail } from "../../components/admin/SessionDetail";

export const Route = createFileRoute("/admin/sessions/$sessionId")({
  component: SessionPage,
});

function SessionPage() {
  const { sessionId } = Route.useParams();

  return (
    <Box>
      <Link to="/admin/sessions">
        <Button startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>
          All sessions
        </Button>
      </Link>

      <AdminSessionOverview sessionId={sessionId} />

      <Divider sx={{ my: 4 }} />

      <SessionDetail sessionId={sessionId} />
    </Box>
  );
}
