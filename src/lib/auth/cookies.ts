import { cookies } from "next/headers";

/** httpOnly JWT cookie holding the student session. Same-origin only — no header/localStorage fallback. */
export const SESSION_COOKIE_NAME = "student_session";

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: THIRTY_DAYS_SECONDS,
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
