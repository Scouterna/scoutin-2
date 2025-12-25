import { createFileRoute } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { HeroLayout } from "@/components/HeroLayout";
import { sessionInfoAtom } from "@/store/session";
import heroVideoUrl from "../../assets/hero_video_cropped.webm";
import { StartContent } from "../components/StartContent";

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

function RouteComponent() {
  const [sessionInfo, setSessionInfo] = useAtom(sessionInfoAtom);

  return (
    <HeroLayout
      heroContent={<StartContent />}
      progressed={!!sessionInfo}
      showBackButton={true}
      onBackClick={() => {
        // TODO: Don't clear the session always, just on "total reset". Also,
        // clear the authentication state.
        setSessionInfo(null);
      }}
      backgroundVideoUrl={heroVideoUrl}
    >
      <pre>{JSON.stringify(sessionInfo, null, 2)}</pre>
    </HeroLayout>
  );
}
