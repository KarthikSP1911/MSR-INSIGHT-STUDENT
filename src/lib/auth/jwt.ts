import { SignJWT, jwtVerify } from "jose";

/** 160-day session TTL — matches the persistent cookie maxAge when "Remember Me" is checked. */
const SESSION_TTL = "160d";

/**
 * Sessions issued before this moment are rejected, so every student signs in once more and is shown the
 * Terms and Conditions checkbox on the login form. Move it forward to force another sign-in for everyone.
 */
export const SESSIONS_VALID_FROM = Math.floor(Date.UTC(2026, 9, 8, 14, 0) / 1000);

export interface StudentTokenPayload {
  usn: string;
}

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set. Configure it in .env before issuing sessions.");
  }
  return new TextEncoder().encode(secret);
}

/** Signs a student session JWT. `usn` is always stored uppercase. */
export async function signStudentToken(usn: string): Promise<string> {
  return new SignJWT({ usn: usn.toUpperCase() })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(getSecretKey());
}

/** Verifies a student session JWT, returning its payload or null if invalid/expired. */
export async function verifyStudentToken(
  token: string | undefined | null,
): Promise<StudentTokenPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (typeof payload.usn !== "string") return null;
    if (typeof payload.iat !== "number" || payload.iat < SESSIONS_VALID_FROM) return null;
    return { usn: payload.usn };
  } catch {
    return null;
  }
}
