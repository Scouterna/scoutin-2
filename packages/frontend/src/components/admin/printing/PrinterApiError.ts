/** The server's `{ error }` message for a failed response, or the fallback. */
export async function apiErrorMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Not JSON: keep the fallback.
  }
  return fallback;
}
