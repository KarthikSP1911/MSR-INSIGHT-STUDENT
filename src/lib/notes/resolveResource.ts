import { RESOURCE_CONFIG, type ResourceTabId, type SemesterResourceConfig } from "./config";

/**
 * Resolves a single resource URL for (branch, semester, tab, subject).
 *
 * Resolution order:
 *   1. A subject-specific URL in `tabs[tabId].subjects[subjectCode]`.
 *   2. The tab's `allSubjects` fallback.
 *   3. `null` — the resource is unavailable for that subject.
 *
 * This is the one place that logic lives; components should always call
 * this (or the helpers below) instead of reading RESOURCE_CONFIG directly.
 */
export function resolveResourceUrl(
  branch: string,
  semester: number,
  tabId: ResourceTabId,
  subjectCode: string,
): string | null {
  const tab = RESOURCE_CONFIG[branch]?.[semester]?.[tabId];
  if (!tab) return null;
  return tab.subjects?.[subjectCode] ?? tab.allSubjects ?? null;
}

/** All tabs configured for a given branch + semester (e.g. `{ notes: {...}, pyqs: {...} }`), if any. */
export function getSemesterTabs(branch: string, semester: number): SemesterResourceConfig | undefined {
  return RESOURCE_CONFIG[branch]?.[semester];
}

/** True if at least one tab in this branch/semester resolves to a real URL for at least one subject. */
export function hasAnyResourcesForSemester(branch: string, semester: number): boolean {
  const tabs = getSemesterTabs(branch, semester);
  if (!tabs) return false;
  return Object.values(tabs).some(
    (tab) => Boolean(tab.allSubjects) || Boolean(tab.subjects && Object.keys(tab.subjects).length > 0),
  );
}
