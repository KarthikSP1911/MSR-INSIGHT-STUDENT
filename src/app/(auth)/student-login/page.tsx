import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getCurrentUsn } from "@/lib/auth/session";
import "@/styles/StudentLogin.css";
import LoginForm from "./LoginForm";

/** Server component so the "already logged in" redirect can read the httpOnly session cookie. */
export default async function StudentLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const usn = await getCurrentUsn();
  const params = await searchParams;
  // ?relogin=1 is the one case an already-authenticated visit to this page is intentional —
  // the dashboard sends a signed-in user with no saved portal PIN here to re-verify it
  // through this same secondary-auth form, so the usual "already logged in" bounce needs to
  // skip past instead of sending them straight back to the dashboard.
  if (usn && params.relogin !== "1") {
    redirect("/student/dashboard");
  }
  // LoginForm reads ?error= via useSearchParams, which Next.js requires a Suspense boundary for.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
