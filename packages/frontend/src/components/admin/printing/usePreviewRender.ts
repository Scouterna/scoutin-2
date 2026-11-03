import { useEffect, useState } from "react";
import { api } from "@/api/api";
import { apiErrorMessage } from "./PrinterApiError";

export type PreviewSize = {
  dpi: number;
  widthDots: number;
  lengthDots: number;
};

export type PreviewRequest = {
  template: string;
  /** JSON of the values, or null while they are invalid (nothing renders). */
  valuesKey: string | null;
  size: PreviewSize;
  printer?: { name: string; serial: string; pool?: string; relay?: string };
  /** Bumps when the templates were reloaded, to render again. */
  revision: number;
  /** Box outlines; the image then isn't the 1-bit bitmap. */
  debug?: boolean;
};

export type PreviewState = {
  /** Object URL of the latest good image; kept while the next one renders. */
  url: string | null;
  ms: number | null;
  blackPercent: number | null;
  loading: boolean;
  error: string | null;
};

const DEBOUNCE_MS = 300;

function numberHeader(res: Response, name: string): number | null {
  const raw = res.headers.get(name);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Renders one preview, debounced; a newer request aborts the one in flight so
 * a slow old render can never replace a newer image.
 */
export function usePreviewRender(request: PreviewRequest | null): PreviewState {
  const [state, setState] = useState<PreviewState>({
    url: null,
    ms: null,
    blackPercent: null,
    loading: false,
    error: null,
  });

  const { template, valuesKey, size, printer, revision, debug } = request ?? {};
  const printerKey = JSON.stringify(printer ?? null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the key fields stand for the objects they come from
  useEffect(() => {
    if (!template || valuesKey === undefined || valuesKey === null || !size) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(async () => {
      try {
        const res = await api.admin.printing.templates[":name"].preview.$post(
          {
            param: { name: template },
            json: {
              values: JSON.parse(valuesKey),
              ...size,
              ...(printer ? { printer } : {}),
              ...(debug ? { debug: true } : {}),
            },
          },
          { init: { signal: controller.signal } },
        );
        if (!res.ok) {
          throw new Error(await apiErrorMessage(res, `Error ${res.status}`));
        }
        const url = URL.createObjectURL(await res.blob());
        if (controller.signal.aborted) {
          URL.revokeObjectURL(url);
          return;
        }
        setState({
          url,
          ms: numberHeader(res, "X-Render-Ms"),
          blackPercent: numberHeader(res, "X-Black-Percent"),
          loading: false,
          error: null,
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : "Unknown error",
        }));
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    template,
    valuesKey,
    size?.dpi,
    size?.widthDots,
    size?.lengthDots,
    printerKey,
    revision,
    debug,
  ]);

  // Free the URL of a replaced image, and of the last one on unmount.
  useEffect(
    () => () => {
      if (state.url) URL.revokeObjectURL(state.url);
    },
    [state.url],
  );

  return state;
}
