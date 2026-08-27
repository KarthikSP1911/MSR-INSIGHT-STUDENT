import { getSessionToken } from "./cookies";
import { verifyStudentToken } from "./jwt";

/** Resolves the logged-in student's USN from the session cookie, or null if unauthenticated. */
export async function getCurrentUsn(): Promise<string | null> {
  const token = await getSessionToken();
  const payload = await verifyStudentToken(token);
  return payload?.usn ?? null;
}
