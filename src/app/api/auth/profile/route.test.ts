import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCurrentUsn } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { GET } from "./route";

vi.mock("@/lib/auth/session", () => ({ getCurrentUsn: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn() }));

const session = vi.mocked(getCurrentUsn);
const database = vi.mocked(getDb);

/** A db whose `select().from().where()` chain rejects (or resolves) with the given outcome. */
const dbWith = (outcome: () => Promise<unknown>) =>
  ({ select: () => ({ from: () => ({ where: outcome }) }) }) as unknown as ReturnType<typeof getDb>;

beforeEach(() => {
  session.mockReset();
  database.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/auth/profile", () => {
  it("rejects a request with no session", async () => {
    session.mockResolvedValue(null);

    expect((await GET()).status).toBe(401);
  });

  it("returns the student without the encrypted PIN", async () => {
    session.mockResolvedValue("1MS23IS051");
    database.mockReturnValue(dbWith(async () => [{ usn: "1MS23IS051", name: "A", encryptedPin: "secret" }]));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.usn).toBe("1MS23IS051");
    expect(body.data).not.toHaveProperty("encryptedPin");
  });

  it("answers 404 when the student has no row", async () => {
    session.mockResolvedValue("1MS23IS051");
    database.mockReturnValue(dbWith(async () => []));

    expect((await GET()).status).toBe(404);
  });

  it("answers 503 database_unavailable when the database cannot be reached", async () => {
    session.mockResolvedValue("1MS23IS051");
    database.mockReturnValue(dbWith(() => Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }))));

    const res = await GET();

    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("database_unavailable");
  });

  it("keeps a plain 500 for an error that is not an outage", async () => {
    session.mockResolvedValue("1MS23IS051");
    database.mockReturnValue(dbWith(() => Promise.reject(new Error("syntax error"))));

    const res = await GET();

    expect(res.status).toBe(500);
    expect((await res.json()).code).toBeUndefined();
  });
});
