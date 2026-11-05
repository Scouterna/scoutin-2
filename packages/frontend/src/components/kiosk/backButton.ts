type BackButtonInput = {
  locked: boolean;
  canGoBack: boolean;
  historyLength: number;
  staff: boolean;
};

/**
 * Decides whether the back button is shown. Within-step screen history can
 * always be popped locally, so it counts as a way back. A kiosk hides the button
 * while the step is locked, since the server would refuse the go-back. Staff can
 * override the lock, so it stays visible for them.
 */
export function showBackButton({
  locked,
  canGoBack,
  historyLength,
  staff,
}: BackButtonInput): boolean {
  if (historyLength === 0 && !canGoBack) return false;
  if (staff) return true;
  return !locked;
}
