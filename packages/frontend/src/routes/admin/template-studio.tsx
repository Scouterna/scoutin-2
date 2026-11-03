import Typography from "@mui/material/Typography";
import { createFileRoute } from "@tanstack/react-router";
import { TemplateStudio } from "@/components/admin/printing/TemplateStudio";
import { assertAdmin } from "@/lib/user-context";

export const Route = createFileRoute("/admin/template-studio")({
  beforeLoad: ({ context }) => assertAdmin(context),
  component: TemplateStudioPage,
});

function TemplateStudioPage() {
  // The backend routes only exist in development, so a production build has
  // nothing to talk to. The studio is imported either way; the check is cheap.
  if (!import.meta.env.DEV) {
    return (
      <Typography variant="body1">
        The template studio is only available in development mode.
      </Typography>
    );
  }
  return <TemplateStudio />;
}
