import { redirect } from "next/navigation";

import { getCurrentUsn } from "@/lib/auth/session";

/** Server component so the redirect can read the httpOnly session cookie. */
export default async function Home() {
  const usn = await getCurrentUsn();
  redirect(usn ? "/student/dashboard" : "/student-login");
}
