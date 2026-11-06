import {
  Assessment as AssessmentIcon,
  Block as BlockIcon,
  Brush as BrushIcon,
  CropLandscape as CropLandscapeIcon,
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
  Group as GroupIcon,
  HowToReg as HowToRegIcon,
  Link as LinkIcon,
  ManageAccounts as ManageAccountsIcon,
  Menu as MenuIcon,
  Print as PrintIcon,
  Route as RouteIcon,
  Schedule as ScheduleIcon,
  Tune as TuneIcon,
} from "@mui/icons-material";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { api } from "@/api/api";
import { hasRole, useUser } from "@/lib/user-context";
import { ListItemButtonLink } from "./muiLinks";

const drawerWidth = 240;
const sidebarStorageKey = "admin-sidebar-open";

function readSidebarOpen(): boolean {
  try {
    return localStorage.getItem(sidebarStorageKey) !== "false";
  } catch {
    return true;
  }
}

// Pages living under the collapsible "Avancerat" section.
function isAdvancedPath(pathname: string): boolean {
  return [
    "/admin/jobs",
    "/admin/sessions",
    "/admin/kiosks",
    "/admin/links",
    "/admin/blocklist",
    "/admin/users",
    "/admin/template-studio",
  ].some((path) => pathname.startsWith(path));
}

export type Props = {
  children: ReactNode;
};

export function AdminLayout({ children }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useUser();
  const isAdmin = hasRole(user, "admin");

  // Start expanded when the user is already on one of the advanced pages, so
  // the active item is visible on load.
  const [advancedOpen, setAdvancedOpen] = useState(() =>
    isAdvancedPath(location.pathname),
  );

  const [sidebarOpen, setSidebarOpen] = useState(readSidebarOpen);

  const toggleSidebar = () => {
    setSidebarOpen((open) => {
      try {
        localStorage.setItem(sidebarStorageKey, String(!open));
      } catch {}
      return !open;
    });
  };

  const handleLogout = async () => {
    await api.admin.auth.logout.$post();
    navigate({ to: "/admin/login" });
  };

  return (
    <Box sx={{ display: "flex" }}>
      <AppBar position="fixed">
        <Toolbar>
          <IconButton
            color="inherit"
            edge="start"
            aria-label={sidebarOpen ? "Dölj sidomeny" : "Visa sidomeny"}
            onClick={toggleSidebar}
            sx={{ mr: 2 }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
            Scoutin 2 Admin
          </Typography>
          <Typography variant="body2" noWrap sx={{ mr: 2, opacity: 0.9 }}>
            {user.username}
          </Typography>
          <Button color="inherit" onClick={handleLogout}>
            Logga ut
          </Button>
        </Toolbar>
      </AppBar>
      <Drawer
        sx={(theme) => ({
          width: sidebarOpen ? drawerWidth : 0,
          flexShrink: 0,
          transition: theme.transitions.create("width", {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.shorter,
          }),
          "& .MuiDrawer-paper": {
            // Layer order, back to front: this sidebar, the app bar, then
            // sheets and dialogs.
            zIndex: theme.zIndex.appBar - 1,
            transform: sidebarOpen ? "none" : `translateX(-${drawerWidth}px)`,
            visibility: "visible",
            transition: theme.transitions.create("transform", {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.shorter,
            }),
            width: drawerWidth,
            boxSizing: "border-box",
          },
        })}
        variant="permanent"
        anchor="left"
      >
        <Toolbar />
        <Divider />
        <List>
          <ListItem disablePadding>
            <ListItemButtonLink
              to={"/admin"}
              activeOptions={{ exact: true }}
              activeProps={{ selected: true }}
            >
              <ListItemIcon>
                <AssessmentIcon />
              </ListItemIcon>
              <ListItemText primary="Rapporter" />
            </ListItemButtonLink>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButtonLink
              to={"/admin/checkin"}
              activeProps={{ selected: true }}
            >
              <ListItemIcon>
                <HowToRegIcon />
              </ListItemIcon>
              <ListItemText primary="Incheckning" />
            </ListItemButtonLink>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButtonLink
              to={"/admin/participants"}
              activeProps={{ selected: true }}
            >
              <ListItemIcon>
                <GroupIcon />
              </ListItemIcon>
              <ListItemText primary="Deltagare" />
            </ListItemButtonLink>
          </ListItem>
          {isAdmin && (
            <ListItem disablePadding>
              <ListItemButtonLink
                to={"/admin/printing"}
                search={{ tab: "relays" }}
                activeProps={{ selected: true }}
              >
                <ListItemIcon>
                  <PrintIcon />
                </ListItemIcon>
                <ListItemText primary="Utskrift" />
              </ListItemButtonLink>
            </ListItem>
          )}
          <ListItem disablePadding>
            <ListItemButton onClick={() => setAdvancedOpen((open) => !open)}>
              <ListItemIcon>
                <TuneIcon />
              </ListItemIcon>
              <ListItemText primary="Avancerat" />
              {advancedOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </ListItemButton>
          </ListItem>
          <Collapse in={advancedOpen} timeout="auto" unmountOnExit>
            <List disablePadding>
              {isAdmin && (
                <>
                  <ListItem disablePadding>
                    <ListItemButtonLink
                      to={"/admin/blocklist"}
                      activeProps={{ selected: true }}
                      sx={{ pl: 4 }}
                    >
                      <ListItemIcon>
                        <BlockIcon />
                      </ListItemIcon>
                      <ListItemText primary="Blockering" />
                    </ListItemButtonLink>
                  </ListItem>
                  <ListItem disablePadding>
                    <ListItemButtonLink
                      to={"/admin/jobs"}
                      activeProps={{ selected: true }}
                      sx={{ pl: 4 }}
                    >
                      <ListItemIcon>
                        <ScheduleIcon />
                      </ListItemIcon>
                      <ListItemText primary="Jobb" />
                    </ListItemButtonLink>
                  </ListItem>
                  {import.meta.env.DEV && (
                    <ListItem disablePadding>
                      <ListItemButtonLink
                        to={"/admin/template-studio"}
                        activeProps={{ selected: true }}
                        sx={{ pl: 4 }}
                      >
                        <ListItemIcon>
                          <BrushIcon />
                        </ListItemIcon>
                        <ListItemText primary="Template studio" />
                      </ListItemButtonLink>
                    </ListItem>
                  )}
                </>
              )}
              <ListItem disablePadding>
                <ListItemButtonLink
                  to={"/admin/sessions"}
                  activeProps={{ selected: true }}
                  sx={{ pl: 4 }}
                >
                  <ListItemIcon>
                    <RouteIcon />
                  </ListItemIcon>
                  <ListItemText primary="Sessions" />
                </ListItemButtonLink>
              </ListItem>
              {isAdmin && (
                <>
                  <ListItem disablePadding>
                    <ListItemButtonLink
                      to={"/admin/kiosks"}
                      activeProps={{ selected: true }}
                      sx={{ pl: 4 }}
                    >
                      <ListItemIcon>
                        <CropLandscapeIcon />
                      </ListItemIcon>
                      <ListItemText primary="Kiosks" />
                    </ListItemButtonLink>
                  </ListItem>
                  <ListItem disablePadding>
                    <ListItemButtonLink
                      to={"/admin/links"}
                      activeProps={{ selected: true }}
                      sx={{ pl: 4 }}
                    >
                      <ListItemIcon>
                        <LinkIcon />
                      </ListItemIcon>
                      <ListItemText primary="Links" />
                    </ListItemButtonLink>
                  </ListItem>
                  <ListItem disablePadding>
                    <ListItemButtonLink
                      to={"/admin/users"}
                      activeProps={{ selected: true }}
                      sx={{ pl: 4 }}
                    >
                      <ListItemIcon>
                        <ManageAccountsIcon />
                      </ListItemIcon>
                      <ListItemText primary="Användare" />
                    </ListItemButtonLink>
                  </ListItem>
                </>
              )}
            </List>
          </Collapse>
        </List>
        <Divider />
      </Drawer>
      <Box
        component="main"
        // minWidth 0: without it wide content (the studio canvas) stretches
        // the page instead of scrolling inside its own box.
        sx={{ flexGrow: 1, minWidth: 0, bgcolor: "background.default", p: 3 }}
      >
        <Toolbar />

        {children}
      </Box>
    </Box>
  );
}
