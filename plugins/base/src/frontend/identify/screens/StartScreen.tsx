import {
  BottomSheet,
  usePluginMessage,
  usePluginSocket,
  ValidationError,
} from "@scouterna/scoutin-plugin-api/frontend";
import { ScoutButton, ScoutField, ScoutInput } from "@scouterna/ui-react";
import BackspaceIcon from "@tabler/icons/outline/backspace.svg?raw";
import KeyboardIcon from "@tabler/icons/outline/keyboard.svg?raw";
import { IconArrowDown, IconQrcode } from "@tabler/icons-react";
import { type } from "arktype";
import { useRef, useState } from "react";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";
import { cn } from "../utils";

function BackspaceButton({ onDelete }: { onDelete: () => void }) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function stopRepeat() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }

  return (
    <ScoutButton
      size="large"
      icon={BackspaceIcon}
      iconOnly
      onPointerDown={(e) => {
        e.preventDefault();
        timeoutRef.current = setTimeout(() => {
          intervalRef.current = setInterval(onDelete, 80);
        }, 400);
      }}
      onPointerUp={stopRepeat}
      onPointerLeave={stopRepeat}
      onClick={onDelete}
    />
  );
}

const arrowRotations = {
  bottom: "0deg",
  top: "180deg",
  left: "90deg",
  right: "270deg",
} as const;

const Payload = type({
  "scannerSide?": "'top' | 'bottom' | 'left' | 'right'",
});

export function StartScreen({ payload }: { payload: object }) {
  const socket = usePluginSocket();
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  const [manualEntryValue, setManualEntryValue] = useState("");
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
    submitQuery(manualEntryValue);
  };

  const closeManualEntry = () => {
    setManualEntryOpen(false);
    setManualEntryValue("");
    setNoResultsQuery(null);
  };

  const validPayload = Payload(payload);
  if (validPayload instanceof type.errors) {
    return <ValidationError errors={validPayload} />;
  }

  const arrowRotation = arrowRotations[validPayload.scannerSide || "bottom"];

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
          validPayload.scannerSide === "right" &&
            "flex-row-reverse justify-end",
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
        <p className="text-body-base text-red-600">Ingen träff. Försök igen.</p>
      )}

      <div>
        <ScoutButton
          icon={KeyboardIcon}
          iconPosition="before"
          onScoutClick={() => setManualEntryOpen(true)}
        >
          Ange manuellt
        </ScoutButton>
      </div>

      <BottomSheet open={manualEntryOpen} onClose={closeManualEntry}>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={handleManualSubmit}
        >
          <div>
            <h2 className="text-heading-xs font-semibold">Ange ID manuellt</h2>
          </div>

          <ScoutField label="Person- eller medlemsnummer">
            <ScoutInput
              size="large"
              inputMode="none"
              value={manualEntryValue}
              onScoutInputChange={(e) => setManualEntryValue(e.detail.value)}
            />
          </ScoutField>

          {noResultsQuery && (
            <p className="text-body-base text-text-danger-base">
              Ingen träff. Försök igen.
            </p>
          )}

          {/** biome-ignore lint/a11y/noStaticElementInteractions: This is just for hiding the right context menu */}
          <div
            className="grid grid-cols-3 grid-rows-[auto_auto_auto_auto] gap-2"
            onContextMenu={(e) => e.preventDefault()}
          >
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0"].map(
              (value, index) =>
                value === "" ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: The indices are hard coded
                  <div key={index} />
                ) : (
                  <ScoutButton
                    // biome-ignore lint/suspicious/noArrayIndexKey: The indices are hard coded
                    key={index}
                    size="large"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => setManualEntryValue((prev) => prev + value)}
                  >
                    {value}
                  </ScoutButton>
                ),
            )}

            <BackspaceButton
              onDelete={() => setManualEntryValue((prev) => prev.slice(0, -1))}
            />

            <ScoutButton
              size="large"
              onClick={closeManualEntry}
              onPointerDown={(e) => e.preventDefault()}
              className="mt-2"
            >
              Avbryt
            </ScoutButton>
            <ScoutButton
              size="large"
              variant="primary"
              type="submit"
              className="flex-1 col-span-2 mt-2"
              onPointerDown={(e) => e.preventDefault()}
              disabled={manualEntryValue.length === 0}
            >
              Checka in
            </ScoutButton>
          </div>
        </form>
      </BottomSheet>
    </div>
  );
}
