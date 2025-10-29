import { createFileRoute } from "@tanstack/react-router";
import { findScreen } from "../../plugins/plugins";

export const Route = createFileRoute("/screen/$screenName")({
  component: RouteComponent,
});

function RouteComponent() {
  const { screenName } = Route.useParams();

  const screen = findScreen(screenName);

  if (!screen) {
    return <div>Screen not found</div>;
  }

  return <screen.component />;
}
