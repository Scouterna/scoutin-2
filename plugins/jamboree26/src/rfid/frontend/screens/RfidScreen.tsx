import {
  usePluginSocket,
  ValidationError,
} from "@scouterna/scoutin-plugin-api/frontend";
import { ScoutButton, ScoutCallout } from "@scouterna/ui-react";
import { type } from "arktype";
import { useEffect, useRef } from "react";

const Payload = type({
  participantName: "string",
  existingChipId: "string | null",
  assignedChipId: "string | null",
  conflict: type({ chipId: "string", ownerName: "string" }).or("null"),
  error: "string | null",
});

// A keyboard-wedge scan arrives as a fast burst of keystrokes; anything slower
// than this between keys is treated as stray input and clears the buffer, so a
// leftover keypress or an aborted read (no Enter) can't prefix the next scan.
const SCAN_IDLE_RESET_MS = 500;

/**
 * Captures a keyboard-wedge RFID reader: it types the tag ID as keystrokes and
 * ends with Enter. We buffer printable keys on the document and fire `onScan`
 * with the accumulated tag ID on Enter, then reset. Listening on the document
 * (rather than a focused input) means the reader works regardless of what has
 * focus - the norm for kiosk scanners here (cf. useBarcodeScanner in base). A
 * ref keeps the latest `onScan` without re-binding the listener each render.
 *
 * The buffer also resets after SCAN_IDLE_RESET_MS of no keystrokes: without
 * this, a stray keypress or a partial read that never sent Enter would sit in
 * the buffer indefinitely and corrupt the next real scan (`garbage+realTagId`).
 */
function useEnterTerminatedScanner(onScan: (data: string) => void) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    let buffer = "";
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const clearIdleTimer = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      if (e.key === "Enter") {
        const data = buffer;
        buffer = "";
        clearIdleTimer();
        if (data.length > 0) {
          e.preventDefault();
          onScanRef.current(data);
        }
        return;
      }

      // Only printable single characters make up the tag ID.
      if (e.key.length === 1) {
        buffer += e.key;
        clearIdleTimer();
        idleTimer = setTimeout(() => {
          buffer = "";
          idleTimer = null;
        }, SCAN_IDLE_RESET_MS);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      clearIdleTimer();
    };
  }, []);
}

export function RfidScreen({ payload }: { payload: object }) {
  const socket = usePluginSocket();

  const validPayload = Payload(payload);

  const callMethod = (name: string, inputs?: Record<string, unknown>) => {
    socket?.send({
      name: "step:callMethod",
      data: inputs ? { name, inputs } : { name },
    });
  };

  // Scanning stays live while waiting for / retrying a tag (including the
  // conflict state, so the operator can try another tag), but is ignored once a
  // tag is bound (success state) - otherwise a stray or duplicate read would
  // silently reassign the tag or flip the confirmed screen back to a conflict.
  useEnterTerminatedScanner((chipId) => {
    if (validPayload instanceof type.errors || validPayload.assignedChipId) {
      return;
    }
    callMethod("scan", { chipId });
  });

  if (validPayload instanceof type.errors) {
    return <ValidationError errors={validPayload} />;
  }

  const { participantName, existingChipId, assignedChipId, conflict, error } =
    validPayload;

  // Success state: a tag has been bound this session. Confirm to advance.
  if (assignedChipId) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-heading-base font-semibold">Dela ut RFID-tagg</h1>
        </div>

        <ScoutCallout variant="success" heading="Tagg kopplad">
          Taggen <span className="font-semibold">{assignedChipId}</span> är nu
          kopplad till <span className="font-semibold">{participantName}</span>.
        </ScoutCallout>

        <div className="flex justify-end">
          <ScoutButton
            variant="primary"
            onScoutClick={() => callMethod("confirm")}
          >
            Fortsätt
          </ScoutButton>
        </div>
      </div>
    );
  }

  // Scanning state.
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-heading-base font-semibold">Dela ut RFID-tagg</h1>
        <p className="text-body-base">
          Skanna en tagg för att koppla den till{" "}
          <span className="font-semibold">{participantName}</span>.
        </p>
      </div>

      {conflict && (
        <ScoutCallout variant="error" heading="Taggen är upptagen">
          <p>
            Denna tagg tillhör redan{" "}
            <span className="font-semibold">{conflict.ownerName}</span>.
          </p>
          <div className="mt-3">
            <ScoutButton
              variant="primary"
              onScoutClick={() =>
                callMethod("steal", { chipId: conflict.chipId })
              }
            >
              Ta över taggen
            </ScoutButton>
          </div>
        </ScoutCallout>
      )}

      {error && (
        <ScoutCallout variant="error" heading="Kunde inte koppla taggen">
          {error}
        </ScoutCallout>
      )}

      {existingChipId && (
        <ScoutCallout variant="warning" heading="Har redan en tagg">
          Den här personen har redan en registrerad tagg ({existingChipId}). Om
          du skannar en ny tagg ersätts den gamla.
        </ScoutCallout>
      )}

      <div className="rounded-xl p-4 gap-4 bg-gray-50 border border-gray-100 flex items-center">
        <span className="text-4xl leading-none" aria-hidden>
          📡
        </span>
        <div className="flex-1">
          <p className="font-bold">Redo att skanna...</p>
          <p>Håll taggen mot läsaren.</p>
        </div>
      </div>

      <div className="flex justify-end">
        <ScoutButton variant="outlined" onScoutClick={() => callMethod("skip")}>
          Hoppa över
        </ScoutButton>
      </div>
    </div>
  );
}
