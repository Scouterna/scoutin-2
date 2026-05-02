import {
  usePluginMessage,
  usePluginSocket,
} from "@scouterna/scoutin-plugin-api";
import { ScoutButton, ScoutField, ScoutInput } from "@scouterna/ui-react";
import KeyboardIcon from "@tabler/icons/outline/keyboard.svg?raw";
import { IconArrowDown, IconQrcode } from "@tabler/icons-react";
import { useState } from "react";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";
import { cn } from "../utils";

const scannerSide = import.meta.env.VITE_SCANNER_SIDE || "down";
const arrowRotations = {
  bottom: "0deg",
  top: "180deg",
  left: "90deg",
  right: "270deg",
} as const;
const arrowRotation =
  arrowRotations[scannerSide as keyof typeof arrowRotations] || "0deg";

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
          <h1 className="text-heading-base font-semibold">Skanna ditt kort</h1>
          <p className="text-body-base">
            Visa ditt körkort eller medlemskort från Scoutnet för läsaren.
          </p>
        </div>

        <div className="rounded-xl p-4 gap-4 bg-gray-50 border border-gray-100 flex">
          <IconQrcode className="size-12" stroke={1.5} />

          <div className="flex-1">
            <p className="font-bold">Skanna ditt kort</p>
            <p>
              Körkort eller medlemskort från Scoutnet på din telefon fungerar.
            </p>
          </div>
        </div>

        <div
          className={cn(
            "flex gap-2 items-center",
            scannerSide === "right" && "flex-row-reverse justify-end",
          )}
        >
          <div
            className="size-12"
            style={{
              transform: `rotate(${arrowRotation})`,
            }}
          >
            <IconArrowDown
              className="w-full h-full animate-oscillate-vertical text-blue-400"
              stroke={1.5}
            />
          </div>

          <span className="text-body-sm italic text-blue-400">
            Redo att skanna...
          </span>
        </div>

        {noResultsQuery && (
          <p className="text-body-base text-red-600">
            Ingen träff. Försök igen.
          </p>
        )}

        <div>
          <ScoutButton
            icon={KeyboardIcon}
            iconPosition="before"
            onScoutClick={() => setMode("manual")}
          >
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
        <h1 className="text-heading-base font-semibold">Ange manuellt</h1>
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
