import { useAtomValue } from "jotai";
import { findScreen } from "@/plugins/plugins";
import { currentScreenAtom } from "@/store/session";

export function ScreenRenderer() {
  const currentScreenInfo = useAtomValue(currentScreenAtom);

  if (!currentScreenInfo) {
    return <div>No screen selected</div>;
  }

  const currentScreen = findScreen(currentScreenInfo.screenId);

  if (!currentScreen) {
    return (
      <div>
        Screen not found: <pre>{currentScreenInfo.screenId}</pre>
      </div>
    );
  }

  return <currentScreen.component payload={currentScreenInfo.payload} />;
}
