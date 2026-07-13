import { usePluginSocket } from "@scouterna/scoutin-plugin-api/frontend";
import { ScoutButton, ScoutCallout } from "@scouterna/ui-react";
import { useEffect } from "react";

// Auto-return to the welcome screen after this long, so the kiosk frees up for
// the next person without needing a tap.
const AUTO_RESET_MS = 15_000;

// Shown when the blocklist gate in the identify step rejects a submitted
// identifier. Deliberately vague: never confirm *why* someone is blocked or
// that a list exists. Just direct them to a human.
export function BlockedScreen() {
  const socket = usePluginSocket();

  const handleDone = () => {
    socket?.send({ name: "session:abort" });
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      socket?.send({ name: "session:abort" });
    }, AUTO_RESET_MS);
    return () => clearTimeout(timer);
  }, [socket]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading-base font-semibold">
          Du kan tyvärr inte checka in
        </h1>
      </div>

      <ScoutCallout variant="warning" heading="Kontakta en funktionär">
        Vänd dig till en funktionär i incheckningen så hjälper de dig vidare.
      </ScoutCallout>

      <div className="flex justify-end">
        <ScoutButton variant="primary" onScoutClick={handleDone}>
          Klar
        </ScoutButton>
      </div>
    </div>
  );
}
