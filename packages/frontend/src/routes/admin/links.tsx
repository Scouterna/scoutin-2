import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "@/api/api";
import { assertAdmin } from "@/lib/user-context";

export const Route = createFileRoute("/admin/links")({
  beforeLoad: ({ context }) => assertAdmin(context),
  component: LinksPage,
});

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Tooltip title={copied ? "Copied!" : "Copy"}>
      <IconButton onClick={handleCopy} size="small">
        <ContentCopyIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

type Link = {
  id: string;
  configFile: string;
  params: unknown;
  createdAt: string;
};

function DeleteLinkDialog({
  link,
  onClose,
}: {
  link: Link;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      const res = await api.admin.links[":id"].$delete({
        param: { id: link.id },
      });
      if (!res.ok) throw new Error("Failed to delete link");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "links"] });
      onClose();
    },
  });

  return (
    <Dialog open onClose={onClose}>
      <DialogTitle>Delete link?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          This will permanently delete the link. Anyone with the URL will no
          longer be able to use it.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          color="error"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const linksQuery = {
  queryKey: ["admin", "links"],
  queryFn: async () => {
    const res = await api.admin.links.$get();
    return res.json();
  },
};

function LinksPage() {
  const queryClient = useQueryClient();
  const [configFile, setConfigFile] = useState("stepConfig.yml");
  const [paramsText, setParamsText] = useState("{}");
  const [paramsError, setParamsError] = useState<string | null>(null);
  const [deletingLink, setDeletingLink] = useState<Link | null>(null);

  const { data } = useQuery(linksQuery);

  const mutation = useMutation({
    mutationFn: async () => {
      let params: Record<string, unknown>;
      try {
        params = JSON.parse(paramsText);
      } catch {
        throw new Error("Invalid JSON in params");
      }
      const res = await api.admin.links.$post({
        json: { configFile, params },
      });
      if (!res.ok) throw new Error("Failed to create link");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "links"] });
    },
  });

  function handleCreate() {
    setParamsError(null);
    try {
      JSON.parse(paramsText);
    } catch {
      setParamsError("Params must be valid JSON");
      return;
    }
    mutation.mutate();
  }

  return (
    <Box sx={{ maxWidth: 700 }}>
      <Typography variant="h5" gutterBottom>
        Links
      </Typography>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 2 }}>
        <TextField
          label="Config file"
          value={configFile}
          onChange={(e) => setConfigFile(e.target.value)}
          fullWidth
        />
        <TextField
          label="Params (JSON)"
          value={paramsText}
          onChange={(e) => setParamsText(e.target.value)}
          multiline
          minRows={3}
          fullWidth
          error={!!paramsError}
          helperText={paramsError}
          slotProps={{ htmlInput: { style: { fontFamily: "monospace" } } }}
        />
        <Button
          variant="contained"
          onClick={handleCreate}
          disabled={mutation.isPending}
          sx={{ alignSelf: "flex-start" }}
        >
          Create link
        </Button>

        {mutation.isError && (
          <Alert severity="error">{(mutation.error as Error).message}</Alert>
        )}

        {mutation.data &&
          (() => {
            const url = `${window.location.origin}/link/${mutation.data.id}`;
            return (
              <TextField
                label="Link URL"
                value={url}
                fullWidth
                slotProps={{
                  input: {
                    readOnly: true,
                    endAdornment: (
                      <InputAdornment position="end">
                        <CopyButton text={url} />
                      </InputAdornment>
                    ),
                  },
                  htmlInput: { style: { fontFamily: "monospace" } },
                }}
              />
            );
          })()}
      </Box>

      <Divider sx={{ my: 4 }} />

      <Typography variant="h6" gutterBottom>
        Existing links
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Link</TableCell>
            <TableCell>Config file</TableCell>
            <TableCell>Params</TableCell>
            <TableCell>Created</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {data?.links.map((link) => {
            const url = `${window.location.origin}/link/${link.id}`;
            return (
              <TableRow key={link.id}>
                <TableCell>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontFamily: "monospace", fontSize: 12 }}
                    >
                      {url}
                    </a>
                    <CopyButton text={url} />
                  </Box>
                </TableCell>
                <TableCell>{link.configFile}</TableCell>
                <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>
                  {JSON.stringify(link.params)}
                </TableCell>
                <TableCell>
                  {new Date(link.createdAt).toLocaleString()}
                </TableCell>
                <TableCell padding="checkbox">
                  <IconButton
                    size="small"
                    onClick={() => setDeletingLink(link)}
                  >
                    <DeleteOutlinedIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {deletingLink && (
        <DeleteLinkDialog
          link={deletingLink}
          onClose={() => setDeletingLink(null)}
        />
      )}
    </Box>
  );
}
