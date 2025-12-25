import { createFileRoute } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { HeroLayout } from "@/components/HeroLayout";
import { currentScreenAtom } from "@/store/session";
import heroVideoUrl from "../../assets/hero_website.mp4";
import { StartContent } from "../components/StartContent";
import { ScreenRenderer } from "../screens/ScreenRenderer";

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

function RouteComponent() {
  const currentScreen = useAtomValue(currentScreenAtom);

  return (
    <HeroLayout
      heroContent={<StartContent />}
      progressed={currentScreen != null}
      showBackButton={true}
      onBackClick={() => {
        // TODO: Don't clear the session always, just on "total reset". Also,
        // clear the authentication state.
        // setSessionInfo(null);
      }}
      backgroundVideoUrl={heroVideoUrl}
    >
      <ScreenRenderer />
    </HeroLayout>
  );
}
