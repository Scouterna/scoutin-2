import {
  BottomSheet,
  useIsIdle,
  usePluginMessage,
  usePluginSocket,
  useTranslations,
  ValidationError,
} from "@scouterna/scoutin-plugin-api/frontend";
import { ScoutButton, ScoutField, ScoutInput } from "@scouterna/ui-react";
import BackspaceIcon from "@tabler/icons/outline/backspace.svg?raw";
import KeyboardIcon from "@tabler/icons/outline/keyboard.svg?raw";
import { IconArrowDown, IconQrcode } from "@tabler/icons-react";
import { type } from "arktype";
import { useRef, useState } from "react";
import { cn } from "../../../utils";
import pointerUrl from "../assets/pointer.svg";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";

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

const dict = {
  sv: {
    title: "Skanna ditt kort",
    description:
      "Visa ditt körkort eller medlemskort från Scoutnet för läsaren.",
    manualEntryLabel: "Ange manuellt",
    calloutTitle: "Skanna ditt kort",
    calloutBody:
      "Körkort eller medlemskort från Scoutnet på din telefon fungerar.",
    readyToScan: "Redo att skanna...",
    noResults: "Ingen träff. Försök igen.",
    manualEntryHeading: "Ange ID manuellt",
    identifierLabel: "Person- eller medlemsnummer",
    cancel: "Avbryt",
    submit: "Checka in",
  },
  en: {
    title: "Scan your card",
    description:
      "Show your driving licence or your Scoutnet membership card to the reader.",
    manualEntryLabel: "Enter manually",
    calloutTitle: "Scan your card",
    calloutBody:
      "A driving licence or your Scoutnet membership card on your phone works.",
    readyToScan: "Ready to scan...",
    noResults: "No match. Please try again.",
    manualEntryHeading: "Enter ID manually",
    identifierLabel: "Personal or membership number",
    cancel: "Cancel",
    submit: "Check in",
  },
};

const Payload = type({
  "scannerSide?": "'top' | 'bottom' | 'left' | 'right'",
  "title?": "string | undefined",
  "description?": "string | undefined",
  "hideCallout?": "boolean | undefined",
  "hideScannerArrow?": "boolean | undefined",
  "manualEntryLabel?": "string | undefined",
  "largeManualEntryButton?": "boolean | undefined",
});

export function StartScreen({ payload }: { payload: object }) {
  const socket = usePluginSocket();
  const t = useTranslations(dict);
  const idle = useIsIdle();
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

  const scannerSide = validPayload.scannerSide || "bottom";
  const arrowRotation = arrowRotations[scannerSide];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading-base font-semibold">
          {validPayload.title ?? t("title")}
        </h1>
        <p className="text-body-base">
          {validPayload.description ?? t("description")}
        </p>
      </div>
      {!validPayload.hideCallout && (
        <div className="rounded-xl p-4 gap-4 bg-gray-50 border border-gray-100 flex">
          <IconQrcode className="size-12" stroke={1.5} />

          <div className="flex-1">
            <p className="font-bold">{t("calloutTitle")}</p>
            <p>{t("calloutBody")}</p>
          </div>
        </div>
      )}
      {!validPayload.hideScannerArrow && scannerSide === "bottom" && (
        // Positioned in the sliding content panel (which spans to the right
        // edge), 50vw from its right: the screen's horizontal center.
        <div className="absolute bottom-4 right-[50vw] translate-x-1/2 pointer-events-none">
          {/* The shadow sits on a wrapper so the image's rotation doesn't
              flip its direction. */}
          <span className="drop-shadow-[0_3px_2px_rgb(0_0_0/0.4)]">
            <img
              src={pointerUrl}
              alt=""
              // The bounce pauses while the idle dialog asks whether anyone
              // is there, and resumes where it left off.
              className={cn(
                "h-40 w-auto rotate-180 animate-oscillate-vertical",
                idle && "[animation-play-state:paused]",
              )}
            />
          </span>
        </div>
      )}
      {!validPayload.hideScannerArrow && scannerSide !== "bottom" && (
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
            {t("readyToScan")}
          </span>
        </div>
      )}
      {noResultsQuery && (
        <p className="text-body-base text-red-600">{t("noResults")}</p>
      )}
      <div>
        <ScoutButton
          icon={KeyboardIcon}
          iconPosition="before"
          size={validPayload.largeManualEntryButton ? "large" : "medium"}
          onScoutClick={() => setManualEntryOpen(true)}
        >
          {validPayload.manualEntryLabel ?? t("manualEntryLabel")}
        </ScoutButton>
      </div>

      {(window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1") && (
        <div className="opacity-20 hover:opacity-100 p-4 -m-4">
          Debug
          <div className="flex gap-2">
            <ScoutButton
              onScoutClick={() => submitQuery("3236298")}
              variant="outlined"
            >
              Ledare (3236298)
            </ScoutButton>
            <ScoutButton
              onScoutClick={() => submitQuery("3307495")}
              variant="outlined"
            >
              Deltagare (3307495)
            </ScoutButton>
          </div>
        </div>
      )}

      <BottomSheet open={manualEntryOpen} onClose={closeManualEntry}>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={handleManualSubmit}
        >
          <div>
            <h2 className="text-heading-xs font-semibold">
              {t("manualEntryHeading")}
            </h2>
          </div>

          <ScoutField label={t("identifierLabel")}>
            <ScoutInput
              size="large"
              inputMode="none"
              value={manualEntryValue}
              onScoutInputChange={(e) => setManualEntryValue(e.detail.value)}
            />
          </ScoutField>

          {noResultsQuery && (
            <p className="text-body-base text-text-danger-base">
              {t("noResults")}
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
              {t("cancel")}
            </ScoutButton>
            <ScoutButton
              size="large"
              variant="primary"
              type="submit"
              className="flex-1 col-span-2 mt-2"
              onPointerDown={(e) => e.preventDefault()}
              disabled={manualEntryValue.length === 0}
            >
              {t("submit")}
            </ScoutButton>
          </div>
        </form>
      </BottomSheet>
    </div>
  );
}
