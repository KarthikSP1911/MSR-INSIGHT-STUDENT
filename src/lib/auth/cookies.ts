import { cookies } from "next/headers";

/** httpOnly JWT cookie holding the student session. Same-origin only — no header/localStorage fallback. */
export const SESSION_COOKIE_NAME = "student_session";

const ONE_SIXTY_DAYS_SECONDS = 160 * 24 * 60 * 60;

/**
 * Sets the session cookie.
 *
 * @param token       - The signed JWT string.
 * @param rememberMe  - When true, sets a persistent cookie (160-day maxAge + expires).
 *                      When false, sets a session cookie (no maxAge/expires) so it is
 *                      cleared when the browser is fully closed.
 */
export async function setSessionCookie(
  token: string,
  rememberMe: boolean,
): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    // Persistent cookie: set both maxAge and expires so older mobile WebViews
    // (which only honour `Expires`, not `Max-Age`) also respect the 160-day TTL.
    // Session cookie: omit both so the browser clears it on close.
    ...(rememberMe && {
      maxAge: ONE_SIXTY_DAYS_SECONDS,
      expires: new Date(Date.now() + ONE_SIXTY_DAYS_SECONDS * 1000),
    }),
  });
}

export async function getSessionToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value;
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}
