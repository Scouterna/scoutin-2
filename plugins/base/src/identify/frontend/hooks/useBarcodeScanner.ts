import { useEffect, useRef } from "react";

/**
 * Captures barcode scanner input. Two modes, each switched by a build-time
 * env var, both on unless set to "false" (see packages/frontend/.env.example):
 *
 * - Markers (`VITE_SCANNER_MARKERS`): a Zebra DS9308
 *   (or similar HID scanner) programmed with prefix "¤" and suffix "¤", so each
 *   scan arrives as ¤<data>¤.
 * - Enter (`VITE_SCANNER_ENTER`): a scanner that types the
 *   data and presses Enter. Without markers, a scan is told apart from a person
 *   typing by speed alone: every keystroke must follow the previous one within
 *   ENTER_MAX_KEY_GAP_MS, which a human can't keep up. This mode is ignored
 *   while a text field is focused (someone is typing by hand), which also means
 *   scan characters never leak into a field.
 */
const MARKERS_ENABLED = import.meta.env.VITE_SCANNER_MARKERS !== "false";
const ENTER_ENABLED = import.meta.env.VITE_SCANNER_ENTER !== "false";

const MARKER = "¤";
const MARKER_TIMEOUT_MS = 1000;
const ENTER_MAX_KEY_GAP_MS = 50;
const ENTER_MIN_LENGTH = 3;

/** True if the focused element is a text field, looking inside shadow roots
 * (ScoutInput wraps its <input> in one). */
function isTextFieldFocused(): boolean {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return (
    el instanceof HTMLElement &&
    (el.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))
  );
}

export function useBarcodeScanner(onScan: (data: string) => void) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    let markerScanning = false;
    let markerBuffer = "";
    let markerTimeout: ReturnType<typeof setTimeout> | null = null;

    let enterBuffer = "";
    let lastKeyAt = 0;

    const resetMarkerScan = () => {
      markerScanning = false;
      markerBuffer = "";
      if (markerTimeout) {
        clearTimeout(markerTimeout);
        markerTimeout = null;
      }
    };

    const handleMarkerKey = (e: KeyboardEvent): boolean => {
      if (e.key === MARKER) {
        if (!markerScanning) {
          markerScanning = true;
          markerBuffer = "";
          markerTimeout = setTimeout(resetMarkerScan, MARKER_TIMEOUT_MS);
        } else {
          const data = markerBuffer;
          resetMarkerScan();
          if (data.length > 0) {
            onScanRef.current(data);
          }
        }
        e.preventDefault();
        return true;
      }

      if (markerScanning) {
        // Skip ALT+key combos (e.g. scanner encoding special chars like LF as ALT+0010)
        if (!e.altKey && e.key.length === 1) {
          markerBuffer += e.key;
        }
        e.preventDefault();
        return true;
      }

      return false;
    };

    const handleEnterKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (isTextFieldFocused()) {
        enterBuffer = "";
        return;
      }

      const now = e.timeStamp;
      if (now - lastKeyAt > ENTER_MAX_KEY_GAP_MS) {
        enterBuffer = "";
      }
      lastKeyAt = now;

      if (e.key === "Enter") {
        const data = enterBuffer;
        enterBuffer = "";
        if (data.length >= ENTER_MIN_LENGTH) {
          e.preventDefault();
          onScanRef.current(data);
        }
      } else if (e.key.length === 1) {
        enterBuffer += e.key;
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (MARKERS_ENABLED && handleMarkerKey(e)) return;
      if (ENTER_ENABLED) handleEnterKey(e);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (markerTimeout) clearTimeout(markerTimeout);
    };
  }, []);
}
