import { toast } from "sonner";

export type ErrorType = "network" | "auth" | "websocket" | "system";

export type AppError = {
  type: ErrorType;
  message: string;
  details?: unknown;
  retry?: boolean;
};

export function createAppError(
  type: ErrorType,
  message: string,
  details?: unknown,
  retry = false,
): AppError {
  return { type, message, details, retry };
}

export function showErrorToast(
  error: unknown,
  fallbackMessage = "Ett fel uppstod",
) {
  let message = fallbackMessage;
  let description: string | undefined;

  if (error instanceof Error) {
    message = error.message || fallbackMessage;
  } else if (typeof error === "string") {
    message = error;
  } else if (error && typeof error === "object" && "message" in error) {
    message = String(error.message) || fallbackMessage;
    if ("details" in error) {
      description = String(error.details);
    }
  }

  toast.error(message, {
    description,
    duration: 5000,
    action: {
      label: "Ladda om",
      onClick: () => window.location.reload(),
    },
  });
}

export function showNetworkErrorToast() {
  toast.error("Nätverksfel", {
    description:
      "Kunde inte ansluta till servern. Kontrollera din internetanslutning.",
    duration: 7000,
  });
}
