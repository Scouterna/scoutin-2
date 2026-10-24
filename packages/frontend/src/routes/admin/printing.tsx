import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useUnknownJobCount } from "@/components/admin/printing/useUnknownJobCount";
import { assertAdmin } from "@/lib/user-context";
import { JobsTab } from "../../components/admin/printing/JobsTab";
import { PoolsTab } from "../../components/admin/printing/PoolsTab";
import { PrintersTab } from "../../components/admin/printing/PrintersTab";
import { RelaysTab } from "../../components/admin/printing/RelaysTab";

const printingTabs = ["relays", "printers", "pools", "jobs"] as const;
type PrintingTab = (typeof printingTabs)[number];

function parseTab(value: unknown): PrintingTab {
  return printingTabs.find((tab) => tab === value) ?? "relays";
}

export const Route = createFileRoute("/admin/printing")({
  beforeLoad: ({ context }) => assertAdmin(context),
  validateSearch: ({ tab }: Record<string, unknown>): { tab: PrintingTab } => ({
    tab: parseTab(tab),
  }),
  component: PrintingPage,
});

function PrintingPage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  // Unknown jobs are waiting for staff to settle them.
  const unknownJobs = useUnknownJobCount();

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3 }}>
        Utskrift
      </Typography>
      <Tabs
        value={tab}
        onChange={(_, value: PrintingTab) =>
          navigate({ search: { tab: value } })
        }
        sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab label="Reläer" value="relays" />
        <Tab label="Skrivare" value="printers" />
        <Tab label="Skrivarpooler" value="pools" />
        <Tab
          label={
            <Badge
              color="warning"
              badgeContent={unknownJobs}
              sx={{ pr: unknownJobs ? 1.5 : 0 }}
            >
              Jobb
            </Badge>
          }
          value="jobs"
        />
      </Tabs>

      {tab === "relays" && <RelaysTab />}
      {tab === "printers" && <PrintersTab />}
      {tab === "pools" && <PoolsTab />}
      {tab === "jobs" && <JobsTab />}
    </Box>
  );
}
