import type { Student } from "@/lib/db/schema";

/** A student row that is safe to send to the browser. */
export type SafeStudent = Omit<Student, "encryptedPin" | "encryptedBrowserlessToken">;

/** Drops every encrypted secret from a student row before it is returned from an API route. */
export function toSafeStudent(student: Student): SafeStudent {
  const safe: Partial<Student> = { ...student };
  delete safe.encryptedPin;
  delete safe.encryptedBrowserlessToken;
  return safe as SafeStudent;
}
