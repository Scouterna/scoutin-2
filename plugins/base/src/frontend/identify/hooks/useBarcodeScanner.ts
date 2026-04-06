import { useEffect, useRef } from "react";

/**
 * Captures barcode scanner input from a Zebra DS9308 (or similar HID scanner)
 * configured with prefix "¤" and suffix "¤".
 *
 * The scanner must be programmed to wrap each scan: ¤<data>¤
 */
export function useBarcodeScanner(onScan: (data: string) => void) {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    let scanning = false;
    let buffer = "";
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const resetScan = () => {
      scanning = false;
      buffer = "";
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "¤") {
        if (!scanning) {
          scanning = true;
          buffer = "";
          timeout = setTimeout(resetScan, 1000);
        } else {
          if (timeout) {
            clearTimeout(timeout);
            timeout = null;
          }
          scanning = false;
          if (buffer.length > 0) {
            onScanRef.current(buffer);
          }
          buffer = "";
        }
        e.preventDefault();
        return;
      }

      if (scanning) {
        if (e.key.length === 1) {
          buffer += e.key;
        }
        e.preventDefault();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (timeout) clearTimeout(timeout);
    };
  }, []);
}
