import {
  usePluginMessage,
  usePluginSocket,
} from "@scouterna/scoutin-plugin-api";
import { ScoutButton, ScoutField, ScoutInput } from "@scouterna/ui-react";
import { useState } from "react";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";

export function StartScreen() {
  const socket = usePluginSocket();
  const [mode, setMode] = useState<"scan" | "manual">("scan");
  const [manualValidity, setManualValidity] = useState("");
  const [noResultsQuery, setNoResultsQuery] = useState<string | null>(null);

  const submitQuery = (query: string) => {
    setNoResultsQuery(null);
    socket?.send({
      name: "step:callMethod",
      data: {
        name: "searchByString",
        inputs: { query },
      },
    });
  };

  useBarcodeScanner((data) => {
    submitQuery(data);
  });

  usePluginMessage("base:identify:noResults", (payload) => {
    const { query } = payload as { query: string };
    setNoResultsQuery(query);
  });

  const handleManualSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!e.currentTarget.checkValidity()) return;
    const query = new FormData(e.currentTarget).get("query") as string;
    submitQuery(query);
  };

  if (mode === "scan") {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-heading-base">Skanna ditt kort</h1>
          <p className="text-body-base">
            Håll ditt körkort eller medlemskort från Scoutnet mot läsaren.
          </p>
        </div>

        <div className="flex items-center justify-center h-40 rounded-xl border-2 border-dashed border-gray-300">
          <p className="text-body-base text-gray-400">Redo att skanna...</p>
        </div>

        {noResultsQuery && (
          <p className="text-body-base text-red-600">
            Ingen träff. Försök igen.
          </p>
        )}

        <div>
          <ScoutButton onScoutClick={() => setMode("manual")}>
            Ange manuellt
          </ScoutButton>
        </div>
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={handleManualSubmit}
      className="flex flex-col gap-4"
    >
      <div>
        <h1 className="text-heading-base">Ange manuellt</h1>
        <p className="text-body-base">
          Ange ditt personnummer eller medlemsnummer.
        </p>
      </div>

      {noResultsQuery && (
        <p className="text-body-base text-red-600">Ingen träff. Försök igen.</p>
      )}

      <ScoutField label="Person- eller medlemsnummer">
        <ScoutInput
          name="query"
          validity={manualValidity}
          onScoutValidate={(e) => {
            setManualValidity(
              e.detail.value.length === 0 ? "Fältet får inte vara tomt" : "",
            );
          }}
        />
      </ScoutField>

      <div className="flex gap-2">
        <ScoutButton type="button" onScoutClick={() => setMode("scan")}>
          Tillbaka
        </ScoutButton>
        <ScoutButton type="submit" variant="primary">
          Sök
        </ScoutButton>
      </div>
    </form>
  );
}
