// Once a login redirect has been initiated we're leaving the page, so collapse
// any concurrent triggers (e.g. several admin requests 401ing at once) into a
// single navigation.
let redirecting = false;

/** Hard-navigate to the internal admin login page. Used when an admin request
 * 401s mid-session (outside the router, so window.location rather than the
 * router's redirect). */
export function redirectToLogin(): void {
  if (redirecting) return;
  redirecting = true;
  window.location.href = `${import.meta.env.BASE_URL}admin/login`;
}
