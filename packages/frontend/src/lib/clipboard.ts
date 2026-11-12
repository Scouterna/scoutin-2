/**
 * Copies `text` to the clipboard. Returns false when both methods fail.
 *
 * `navigator.clipboard` only exists in a secure context (HTTPS or localhost),
 * so the admin opened over plain HTTP at an IP or hostname falls back to
 * `execCommand("copy")` on a temporary textarea. The textarea goes inside the
 * focused element's dialog, if any: an MUI dialog's focus trap pulls focus back
 * out of anything appended to <body>, and the copy then selects nothing.
 */
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the fallback.
    }
  }

  const container =
    document.activeElement?.closest('[role="dialog"]') ?? document.body;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  container.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
