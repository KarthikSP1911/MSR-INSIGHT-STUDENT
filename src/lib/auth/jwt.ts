import { SignJWT, jwtVerify } from "jose";

/** 160-day session TTL — matches the persistent cookie maxAge when "Remember Me" is checked. */
const SESSION_TTL = "160d";

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
    return { usn: payload.usn };
  } catch {
    return null;
  }
}
