/**
 * Single source of truth for every Notes/PYQs (and any future resource tab)
 * link shown in the dashboard's "Notes & PYQs" section.
 *
 * Shape: Branch -> Semester -> Tab -> Resource.
 *
 * Each tab's resource config supports two ways to point subjects at a URL:
 *   - `subjects`: a per-subject-code override map (exceptions).
 *   - `allSubjects`: a fallback URL used by any subject with no entry in
 *     `subjects`.
 * See resolveResource.ts for how the two are combined — this file only
 * holds data, never resolution logic, so adding/editing a link here never
 * requires touching any component.
 *
 * `subjects` is keyed by subject CODE (e.g. "23AL61"), matching
 * `Subject.code` from src/lib/studentDetails.ts and the `code` field the
 * scraper attaches to exam_history courses — the same stable identifier
 * already used throughout the app, not the subject's display name (names
 * can have formatting quirks, e.g. inconsistent spacing from the portal).
 */

/** A resource tab's id — "notes" and "pyqs" exist today; the type is a
 * plain string (not a fixed union) so a new tab is pure config, no code
 * change required. */
export type ResourceTabId = string;

export interface TabResourceConfig {
  /** Fallback URL for any subject not listed in `subjects`. */
  allSubjects?: string;
  /** Per-subject-code URL overrides — configure only the exceptions. */
  subjects?: Record<string, string>;
}

/** tabId -> resource config, for one branch + semester. */
export type SemesterResourceConfig = Record<ResourceTabId, TabResourceConfig>;

/** semester number -> config, for one branch. */
export type BranchResourceConfig = Record<number, SemesterResourceConfig>;

/** branch code -> config. */
export type ResourceConfig = Record<string, BranchResourceConfig>;

/**
 * Populated from what MSR-Insight's Notes & PYQs section already had
 * configured (IS branch, Semester 6 only). The PYQs links were identical
 * for every subject in the old data, which is exactly what `allSubjects`
 * is for; the Notes links differed per subject, so they stay as explicit
 * `subjects` entries.
 */
export const RESOURCE_CONFIG: ResourceConfig = {
  IS: {
    6: {
      notes: {
        subjects: {
          "23AL61": "https://drive.google.com/drive/folders/1_cbJig5GJo2wlM8uBywz928lYfDx3J8M?usp=share_link",
          "23IS62": "https://drive.google.com/drive/folders/15WES3thfnamGNGIl5q2DtD_3NBGawLyP?usp=share_link",
          "23ISL65": "https://drive.google.com/drive/folders/1L7MrBiRxaxDvuOk9sK3qq2RZk8BfQ7kE?usp=share_link",
          "23ISE633": "https://drive.google.com/drive/folders/1WOp1h9uL6_BeooJw4-L8adGYMt1k9tYp?usp=share_link",
          "23ISE644": "https://drive.google.com/drive/folders/1gCfPay291RDmi0uusxI3n55MTHp199HT?usp=share_link",
          "23ISE641": "https://drive.google.com/drive/folders/1bKqbUga9QCZYjAXD2hUbBbmbOgaIIvZC?usp=share_link",
          "23ISE632": "https://drive.google.com/drive/folders/1x5POkwugM4M59CFyLyIo_zDOb8-ptiu0?usp=share_link",
        },
      },
      pyqs: {
        allSubjects: "https://drive.google.com/drive/folders/1ZgYw7r6cINanrQ8SqkL4wwS0wZy_oYMs?usp=share_link",
      },
    },
  },
};
