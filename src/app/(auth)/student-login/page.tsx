import { redirect } from "next/navigation";

import { getCurrentUsn } from "@/lib/auth/session";
import LoginForm from "./LoginForm";

/** Server component so the "already logged in" redirect can read the httpOnly session cookie. */
export default async function StudentLoginPage() {
  const usn = await getCurrentUsn();
  if (usn) {
    redirect("/student/dashboard");
  }
  return <LoginForm />;
}
