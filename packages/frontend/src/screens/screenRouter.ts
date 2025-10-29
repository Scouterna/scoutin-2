import { useRouter } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { type CurrentScreen, currentScreenAtom } from "../store/session";

export const useScreenRouter = () => {
  const [_currentScreen, setCurrentScreen] = useAtom(currentScreenAtom);
  const router = useRouter();

  const goToScreen = (screen: CurrentScreen) => {
    setCurrentScreen(screen);

    router.navigate({
      href: `/screen/${screen.screenId}`,
    });
  };

  return {
    goToScreen,
  };
};
