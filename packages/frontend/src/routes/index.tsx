import { ScoutButton } from "@scouterna/ui-react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { HeroLayout } from "@/components/HeroLayout";
import heroVideoUrl from "../../assets/hero_video_cropped.webm";

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

function RouteComponent() {
  const [progressed, setProgressed] = useState(false);

  return (
    <HeroLayout
      heroContent={
        <ScoutButton
          variant="primary"
          onScoutClick={() => {
            setProgressed(true);
          }}
        >
          Checka in
        </ScoutButton>
      }
      progressed={progressed}
      showBackButton={true}
      onBackClick={() => {
        setProgressed(false);
      }}
      backgroundVideoUrl={heroVideoUrl}
    >
      Content
    </HeroLayout>
  );
}
