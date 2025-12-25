import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { findScreen } from "@/plugins/plugins";
import { currentScreenAtom } from "@/store/session";

export function ScreenRenderer() {
  const currentScreenInfo = useAtomValue(currentScreenAtom);

  const currentScreen = useMemo(() => {
    if (!currentScreenInfo) return null;

    return findScreen(currentScreenInfo.screenId);
  }, [currentScreenInfo]);

  if (!currentScreen) {
    return <div>No screen selected</div>;
  }

  return <currentScreen.component />;
}
