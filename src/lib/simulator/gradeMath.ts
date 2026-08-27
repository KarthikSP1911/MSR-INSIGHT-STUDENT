import type { Subject } from "@/lib/studentDetails";

export interface GradeProjectionInput {
  currentSem: Subject[];
  simulatedCredits: Record<string, number>;
  predictedGrades: Record<string, string>;
  totalCredits: number;
  currentCgpa: string | null;
  GRADE_POINTS: Record<string, number>;
}

export interface GradeProjectionResult {
  projSGPA: number;
  projCGPA: number;
}

/** What-if SGPA/CGPA projection: blends the simulated semester's grade points against completed-credit history. */
export function computeGradeProjection({
  currentSem,
  simulatedCredits,
  predictedGrades,
  totalCredits,
  currentCgpa,
  GRADE_POINTS,
}: GradeProjectionInput): GradeProjectionResult {
  let currentTotalPts = 0;
  let currentTotalCredits = 0;

  currentSem.forEach((subj) => {
    const credits = simulatedCredits[subj.code] ?? 4;
    const g = predictedGrades[subj.code] || "O";
    currentTotalPts += (GRADE_POINTS[g] || 0) * credits;
    currentTotalCredits += credits;
  });

  const projSGPA = currentTotalCredits > 0 ? currentTotalPts / currentTotalCredits : 0;
  const historicalCredits = totalCredits;
  const completedPts = parseFloat(currentCgpa || "0") * historicalCredits;
  const projCGPA =
    historicalCredits + currentTotalCredits > 0
      ? (completedPts + currentTotalPts) / (historicalCredits + currentTotalCredits)
      : 0;

  return { projSGPA, projCGPA };
}
