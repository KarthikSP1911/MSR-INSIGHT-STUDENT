import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signStudentToken } from "@/lib/auth/jwt";

import { proxy } from "./proxy";

const request = (path: string, init?: { method?: string; cookie?: string }) =>
  new NextRequest(`http://localhost:3000${path}`, {
    method: init?.method,
    headers: init?.cookie ? { cookie: init.cookie } : undefined,
  });

describe("proxy", () => {
  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", "test-secret-test-secret-test-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("while the site is paused", () => {
    beforeEach(() => {
      vi.stubEnv("SITE_SHUTDOWN", "true");
    });

    it.each([
      ["/api/auth/login", "POST"],
      ["/api/report/update", "POST"],
      ["/api/report/student/1MS23IS051", "GET"],
      ["/api/portal/open", "POST"],
      ["/api/auth/profile", "GET"],
      ["/api/scrape-jobs/abc", "GET"],
    ])("answers %s with 503 and a Retry-After", async (path, method) => {
      const res = await proxy(request(path, { method }));
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBeTruthy();
      expect(await res.json()).toMatchObject({ success: false });
    });

    it.each(["/api/health", "/api/cron/refresh-student-years", "/api/auth/logout"])("lets %s through", async (path) => {
      const res = await proxy(request(path));
      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-next")).toBe("1");
    });

    it("sends dashboard pages to the login page, even with a valid session", async () => {
      const token = await signStudentToken("1MS23IS051");
      const res = await proxy(request("/student/dashboard", { cookie: `student_session=${token}` }));
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/student-login");
    });
  });

  describe("when the site is running", () => {
    beforeEach(() => {
      vi.stubEnv("SITE_SHUTDOWN", "false");
    });

    it("lets API requests through", async () => {
      const res = await proxy(request("/api/auth/login", { method: "POST" }));
      expect(res.headers.get("x-middleware-next")).toBe("1");
    });

    it("redirects dashboard pages to login without a session", async () => {
      const res = await proxy(request("/student/dashboard"));
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/student-login");
    });

    it("lets dashboard pages through with a valid session", async () => {
      const token = await signStudentToken("1MS23IS051");
      const res = await proxy(request("/student/dashboard", { cookie: `student_session=${token}` }));
      expect(res.headers.get("x-middleware-next")).toBe("1");
    });
  });
});
