import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { assertAdmin } from "@/lib/user-context";
import { api } from "../../api/api";

export const Route = createFileRoute("/admin/data")({
  beforeLoad: ({ context }) => assertAdmin(context),
  component: RouteComponent,
});

function RouteComponent() {
  const reimport = useMutation({
    mutationFn: () => api.admin.participants.reimport.$post(),
  });

  return (
    <div className="flex flex-col gap-4 p-4">
      <Typography variant="h5">Data</Typography>
      <div className="flex items-center gap-4">
        <Button
          variant="contained"
          disabled={reimport.isPending}
          onClick={() => reimport.mutate()}
          startIcon={
            reimport.isPending ? (
              <CircularProgress size={16} color="inherit" />
            ) : undefined
          }
        >
          {reimport.isPending ? "Importerar..." : "Importera om data"}
        </Button>
        {reimport.isSuccess && (
          <Typography variant="body2" color="success.main">
            Klar!
          </Typography>
        )}
        {reimport.isError && (
          <Typography variant="body2" color="error">
            Något gick fel.
          </Typography>
        )}
      </div>
    </div>
  );
}
