import { createFileRoute } from "@tanstack/react-router";
import { Button } from "flowbite-react";

export const Route = createFileRoute("/")({
  component: App,
});

function App() {
  return (
    <div>
      <Button>Hello</Button>
    </div>
  );
}
