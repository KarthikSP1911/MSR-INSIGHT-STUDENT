/** One semester slot in the CGPA calculator: a user-entered SGPA plus the credit weight to use for it. */
export interface CgpaSemesterEntry {
  /** User-entered SGPA, or null if that semester's box is empty (ignored in the calculation). */
  sgpa: number | null;
  /**
   * Real credits for this semester if known (from exam_history's credits_earned), or null
   * if unknown — e.g. a semester the student hasn't completed yet. Never fabricated.
   */
  credits: number | null;
}

export interface CgpaCalculationResult {
  /** Credit-weighted CGPA, or null if nothing entered. */
  cgpa: number | null;
  enteredCount: number;
  /**
   * The credit weight used for any entered semester with no real credit data — the average of
   * the *other* entered semesters' real credits, so a manually-entered semester carries a
   * realistic weight instead of barely moving the CGPA. Null when no real credit data exists
   * anywhere in the entered set (falls back to equal weighting, i.e. a plain average).
   */
  fallbackCredits: number | null;
}

/**
 * Credit-weighted CGPA across whichever semester boxes the user filled in. A semester with a
 * known real credit count (from exam_history) is weighted by it. A semester with no known
 * credit data (not yet completed, so nothing real to use) is weighted by the *average* of the
 * other entered semesters' real credits — derived from the student's own data, not invented —
 * so it behaves like a normal semester instead of being effectively ignored. If no entered
 * semester has real credit data at all, every entry gets equal weight (a plain average).
 */
export function computeCreditWeightedCgpa(semesters: CgpaSemesterEntry[]): CgpaCalculationResult {
  const entered = semesters.filter(
    (s): s is CgpaSemesterEntry & { sgpa: number } => s.sgpa !== null && !Number.isNaN(s.sgpa),
  );

  if (entered.length === 0) return { cgpa: null, enteredCount: 0, fallbackCredits: null };

  const knownCredits = entered.map((s) => s.credits).filter((c): c is number => c !== null && c > 0);
  const fallbackCredits =
    knownCredits.length > 0 ? knownCredits.reduce((sum, c) => sum + c, 0) / knownCredits.length : null;

  let totalPoints = 0;
  let totalCredits = 0;
  for (const s of entered) {
    const credits = s.credits && s.credits > 0 ? s.credits : (fallbackCredits ?? 1);
    totalPoints += s.sgpa * credits;
    totalCredits += credits;
  }

  return {
    cgpa: totalCredits > 0 ? totalPoints / totalCredits : null,
    enteredCount: entered.length,
    fallbackCredits,
  };
}
