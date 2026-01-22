import ListItemButton from "@mui/material/ListItemButton";
import { createLink } from "@tanstack/react-router";
import type { ComponentProps } from "react";

export const ListItemButtonLink = createLink(
  ({ ref, ...props }: ComponentProps<typeof ListItemButton>) => {
    return <ListItemButton ref={ref} {...props} />;
  },
);
