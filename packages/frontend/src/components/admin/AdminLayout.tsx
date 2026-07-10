import {
  CropLandscape as CropLandscapeIcon,
  Dashboard as DashboardIcon,
  HowToReg as HowToRegIcon,
  Link as LinkIcon,
  Route as RouteIcon,
} from "@mui/icons-material";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { ListItemButtonLink } from "./muiLinks";

const drawerWidth = 240;

export type Props = {
  children: ReactNode;
};

export function AdminLayout({ children }: Props) {
  return (
    <Box sx={{ display: "flex" }}>
      <AppBar
        position="fixed"
        sx={{ width: `calc(100% - ${drawerWidth}px)`, ml: `${drawerWidth}px` }}
      >
        <Toolbar>
          <Typography variant="h6" noWrap component="div">
            Scoutin 2 Admin
          </Typography>
        </Toolbar>
      </AppBar>
      <Drawer
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: drawerWidth,
            boxSizing: "border-box",
          },
        }}
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
                <DashboardIcon />
              </ListItemIcon>
              <ListItemText primary="Översikt" />
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
              to={"/admin/sessions"}
              activeProps={{ selected: true }}
            >
              <ListItemIcon>
                <RouteIcon />
              </ListItemIcon>
              <ListItemText primary="Sessions" />
            </ListItemButtonLink>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButtonLink
              to={"/admin/kiosks"}
              activeProps={{ selected: true }}
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
            >
              <ListItemIcon>
                <LinkIcon />
              </ListItemIcon>
              <ListItemText primary="Links" />
            </ListItemButtonLink>
          </ListItem>
        </List>
        <Divider />
      </Drawer>
      <Box
        component="main"
        sx={{ flexGrow: 1, bgcolor: "background.default", p: 3 }}
      >
        <Toolbar />

        {children}
      </Box>
    </Box>
  );
}
