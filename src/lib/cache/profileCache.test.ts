import { beforeEach, describe, expect, it } from "vitest";

import type { Student } from "@/lib/db/schema";
import {
  CACHE_MAX_AGE_MS,
  clearCacheOnLogout,
  isDeviceRemembered,
  readCachedProfile,
  readCachedProfileForSession,
  setRememberPreference,
  writeCachedProfile,
  type CacheStorages,
  type StorageLike,
} from "./profileCache";

class FakeStorage implements StorageLike {
  readonly map = new Map<string, string>();
  throwOnAccess = false;

  get length() {
    return this.map.size;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string) {
    if (this.throwOnAccess) throw new Error("storage blocked");
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.throwOnAccess) throw new Error("storage blocked");
    this.map.set(key, value);
  }
  removeItem(key: string) {
    if (this.throwOnAccess) throw new Error("storage blocked");
    this.map.delete(key);
  }
}

const student = (usn: string, name = "Asha"): Student =>
  ({ usn, name, details: { subjects: [] }, examHistory: [], currentYear: 3 }) as unknown as Student;

let persistent: FakeStorage;
let session: FakeStorage;
let storages: CacheStorages;

beforeEach(() => {
  persistent = new FakeStorage();
  session = new FakeStorage();
  storages = { persistent, session };
});

describe("where a profile is kept", () => {
  it("uses sessionStorage when the device is not remembered", () => {
    setRememberPreference(false, storages);
    writeCachedProfile(student("1MS23IS051"), storages);

    expect([...session.map.keys()].some((k) => k.includes("1MS23IS051"))).toBe(true);
    expect([...persistent.map.keys()].some((k) => k.includes("1MS23IS051"))).toBe(false);
  });

  it("uses localStorage when the device is remembered, and drops a stale session copy", () => {
    setRememberPreference(false, storages);
    writeCachedProfile(student("1MS23IS051", "Old"), storages);
    setRememberPreference(true, storages);
    writeCachedProfile(student("1MS23IS051", "New"), storages);

    expect([...session.map.keys()].some((k) => k.includes("1MS23IS051"))).toBe(false);
    expect(readCachedProfile("1MS23IS051", storages)?.student.name).toBe("New");
  });

  it("defaults to not remembered", () => {
    expect(isDeviceRemembered(storages)).toBe(false);
  });
});

describe("reading", () => {
  it("round-trips a profile and reports when it was saved", () => {
    const now = Date.UTC(2026, 9, 7, 10, 0, 0);
    writeCachedProfile(student("1MS23IS051"), storages, now);

    const cached = readCachedProfile("1ms23is051", storages, now + 1000);

    expect(cached?.student.usn).toBe("1MS23IS051");
    expect(cached?.savedAt).toBe(new Date(now).toISOString());
  });

  it("never returns another student's copy", () => {
    writeCachedProfile(student("1MS23IS051"), storages);

    expect(readCachedProfile("1MS23CS999", storages)).toBeNull();
  });

  it("drops and ignores a copy older than the maximum age", () => {
    const now = Date.UTC(2026, 9, 7);
    writeCachedProfile(student("1MS23IS051"), storages, now);

    expect(readCachedProfile("1MS23IS051", storages, now + CACHE_MAX_AGE_MS + 1)).toBeNull();
    expect(session.map.size).toBe(0);
  });

  it.each([
    ["not JSON", "{oops"],
    ["a non-object", "42"],
    ["a missing student", JSON.stringify({ savedAt: new Date().toISOString() })],
    ["a student without details", JSON.stringify({ savedAt: new Date().toISOString(), student: { usn: "1MS23IS051" } })],
    ["an unparseable date", JSON.stringify({ savedAt: "yesterday-ish", student: student("1MS23IS051") })],
  ])("ignores and removes an entry that is %s", (_label, raw) => {
    session.map.set("msr-profile-cache:v1:1MS23IS051", raw);

    expect(readCachedProfile("1MS23IS051", storages)).toBeNull();
    expect(session.map.size).toBe(0);
  });

  it("returns the newer copy when both storages hold one", () => {
    const now = Date.UTC(2026, 9, 7);
    session.map.set(
      "msr-profile-cache:v1:1MS23IS051",
      JSON.stringify({ savedAt: new Date(now).toISOString(), student: student("1MS23IS051", "Newer") }),
    );
    persistent.map.set(
      "msr-profile-cache:v1:1MS23IS051",
      JSON.stringify({ savedAt: new Date(now - 5000).toISOString(), student: student("1MS23IS051", "Older") }),
    );

    expect(readCachedProfile("1MS23IS051", storages, now + 1)?.student.name).toBe("Newer");
  });
});

describe("clearCacheOnLogout", () => {
  it("wipes every saved copy when the device is not remembered", () => {
    setRememberPreference(false, storages);
    writeCachedProfile(student("1MS23IS051"), storages);
    persistent.map.set("msr-profile-cache:v1:1MS23CS999", "x");

    clearCacheOnLogout(storages);

    expect(readCachedProfile("1MS23IS051", storages)).toBeNull();
    expect([...persistent.map.keys()].filter((k) => k.startsWith("msr-profile-cache"))).toEqual([]);
  });

  it("keeps the persistent copy when the device is remembered, but never leaves a session copy", () => {
    setRememberPreference(true, storages);
    writeCachedProfile(student("1MS23IS051"), storages);
    session.map.set("msr-profile-cache:v1:1MS23CS999", "x");

    clearCacheOnLogout(storages);

    expect(readCachedProfile("1MS23IS051", storages)?.student.usn).toBe("1MS23IS051");
    expect(session.map.size).toBe(0);
  });
});

describe("when storage is unavailable", () => {
  it("does not throw on write, read, preference or logout", () => {
    persistent.throwOnAccess = true;
    session.throwOnAccess = true;

    expect(() => setRememberPreference(true, storages)).not.toThrow();
    expect(() => writeCachedProfile(student("1MS23IS051"), storages)).not.toThrow();
    expect(readCachedProfile("1MS23IS051", storages)).toBeNull();
    expect(() => clearCacheOnLogout(storages)).not.toThrow();
  });

  it("copes with no storage at all", () => {
    const none: CacheStorages = { persistent: null, session: null };

    expect(() => writeCachedProfile(student("1MS23IS051"), none)).not.toThrow();
    expect(readCachedProfile("1MS23IS051", none)).toBeNull();
  });
});

describe("readCachedProfileForSession", () => {
  const sessionResponse = (usn: string) => async () => new Response(JSON.stringify({ success: true, data: { usn } }), { status: 200 });

  it("returns the copy for the signed-in student", async () => {
    writeCachedProfile(student("1MS23IS051"), storages);

    const cached = await readCachedProfileForSession(sessionResponse("1MS23IS051") as typeof fetch, storages);

    expect(cached?.student.usn).toBe("1MS23IS051");
  });

  it("returns null when the signed-in student has no copy, even if another student does", async () => {
    writeCachedProfile(student("1MS23IS051"), storages);

    expect(await readCachedProfileForSession(sessionResponse("1MS23CS999") as typeof fetch, storages)).toBeNull();
  });

  it("returns null when nobody is signed in or the route cannot be reached", async () => {
    writeCachedProfile(student("1MS23IS051"), storages);

    const unauthenticated = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    const unreachable = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    expect(await readCachedProfileForSession(unauthenticated, storages)).toBeNull();
    expect(await readCachedProfileForSession(unreachable, storages)).toBeNull();
  });
});
