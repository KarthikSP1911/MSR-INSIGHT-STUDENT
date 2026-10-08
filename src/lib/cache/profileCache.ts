import type { Student } from "@/lib/db/schema";

/**
 * A copy of the signed-in student's last good profile, kept on this device so the dashboard still opens
 * when the database is unreachable. Only the browser-safe profile is stored (the API already strips the
 * encrypted PIN) and never any credential.
 *
 * Where it lives follows "Remember me": ticked -> localStorage (survives closing the browser), unticked ->
 * sessionStorage (gone when the tab closes). On logout an un-remembered copy is wiped; a remembered one stays.
 * A cached copy is only ever shown to the session whose USN matches its key.
 */

const KEY_PREFIX = "msr-profile-cache:v1:";
const REMEMBER_KEY = "msr-remember-device";

/** A copy this old is dropped rather than shown as if it were still meaningful. */
export const CACHE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CacheStorages {
  persistent: StorageLike | null;
  session: StorageLike | null;
}

export interface CachedProfile {
  student: Student;
  /** ISO timestamp of when this copy was saved. */
  savedAt: string;
}

/** Storage can be missing or throw (private mode, blocked site data), so every access is guarded. */
export function browserStorages(): CacheStorages {
  const pick = (name: "localStorage" | "sessionStorage"): StorageLike | null => {
    try {
      return typeof window === "undefined" ? null : window[name];
    } catch {
      return null;
    }
  };
  return { persistent: pick("localStorage"), session: pick("sessionStorage") };
}

const keyFor = (usn: string) => `${KEY_PREFIX}${usn.toUpperCase()}`;

function attempt<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function isCachedStudent(value: unknown): value is Student {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Record<keyof Student, unknown>>;
  return typeof candidate.usn === "string" && typeof candidate.details === "object" && candidate.details !== null;
}

function parseEntry(raw: string | null, now: number): CachedProfile | null {
  if (!raw) return null;
  const parsed = attempt<unknown>(() => JSON.parse(raw), null);
  if (typeof parsed !== "object" || parsed === null) return null;
  const { savedAt, student } = parsed as { savedAt?: unknown; student?: unknown };
  if (typeof savedAt !== "string" || !isCachedStudent(student)) return null;
  const savedTime = new Date(savedAt).getTime();
  if (Number.isNaN(savedTime) || now - savedTime > CACHE_MAX_AGE_MS) return null;
  return { student, savedAt };
}

/** Whether the student ticked "Remember me" on this device at their last sign-in. */
export function isDeviceRemembered(storages: CacheStorages = browserStorages()): boolean {
  return attempt(() => storages.persistent?.getItem(REMEMBER_KEY) === "1", false);
}

/** Records the "Remember me" choice, which decides where the cached profile is kept. */
export function setRememberPreference(remember: boolean, storages: CacheStorages = browserStorages()): void {
  attempt(() => storages.persistent?.setItem(REMEMBER_KEY, remember ? "1" : "0"), undefined);
}

/** Saves the profile, replacing any older copy for that USN in either storage. */
export function writeCachedProfile(
  student: Student,
  storages: CacheStorages = browserStorages(),
  now: number = Date.now(),
): void {
  const key = keyFor(student.usn);
  const remembered = isDeviceRemembered(storages);
  const target = remembered ? storages.persistent : storages.session;
  const other = remembered ? storages.session : storages.persistent;

  attempt(() => other?.removeItem(key), undefined);
  attempt(() => target?.setItem(key, JSON.stringify({ savedAt: new Date(now).toISOString(), student })), undefined);
}

/** The saved copy for `usn`, or null when there is none, it is malformed or it has expired. */
export function readCachedProfile(
  usn: string,
  storages: CacheStorages = browserStorages(),
  now: number = Date.now(),
): CachedProfile | null {
  const key = keyFor(usn);
  const entries = [storages.session, storages.persistent].map((store) => {
    const raw = attempt(() => store?.getItem(key) ?? null, null);
    const entry = parseEntry(raw, now);
    if (raw && !entry) attempt(() => store?.removeItem(key), undefined);
    return entry;
  });

  return entries.reduce<CachedProfile | null>(
    (best, entry) => (entry && (!best || entry.savedAt > best.savedAt) ? entry : best),
    null,
  );
}

function removeAllCachedProfiles(store: StorageLike | null): void {
  if (!store) return;
  attempt(() => {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key?.startsWith(KEY_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => store.removeItem(key));
  }, undefined);
}

/**
 * Called when the student signs out. A device that was not remembered loses every saved copy; a remembered
 * device keeps its copy so the dashboard can still open during an outage after the next sign-in.
 */
export function clearCacheOnLogout(storages: CacheStorages = browserStorages()): void {
  removeAllCachedProfiles(storages.session);
  if (!isDeviceRemembered(storages)) removeAllCachedProfiles(storages.persistent);
}

/**
 * The saved copy for whoever is signed in, found through the database-free session route. Returns null
 * when nobody is signed in, the route cannot be reached, or there is no saved copy for that student.
 */
export async function readCachedProfileForSession(
  fetchImpl: typeof fetch = fetch,
  storages: CacheStorages = browserStorages(),
): Promise<CachedProfile | null> {
  try {
    const res = await fetchImpl("/api/auth/session");
    if (!res.ok) return null;
    const body: { data?: { usn?: unknown } } = await res.json();
    const usn = body.data?.usn;
    return typeof usn === "string" ? readCachedProfile(usn, storages) : null;
  } catch {
    return null;
  }
}
