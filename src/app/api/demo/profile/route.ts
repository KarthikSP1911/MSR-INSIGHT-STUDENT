import { NextResponse } from "next/server";

import type { Assessment, AttendanceDetails, ExamHistoryEntry, StudentDetails, Subject } from "@/lib/studentDetails";

/** Synthetic data only: this public route never reads the database or the session. */

const attendance = (present: number, absent: number): AttendanceDetails => ({
  present,
  absent,
  remaining: 10,
  percentage: Math.round((present / (present + absent)) * 100),
  present_dates: ["06-01-2026", "07-01-2026", "08-01-2026", "12-01-2026"],
  absent_dates: ["09-01-2026"],
});

const assessments = (t1: number, t2: number, aq1: number, aq2: number): Assessment[] => [
  { type: "T1", obtained_marks: t1, class_average: 32 },
  { type: "T2", obtained_marks: t2, class_average: 34 },
  { type: "AQ1", obtained_marks: aq1, class_average: 8 },
  { type: "AQ2", obtained_marks: aq2, class_average: 8 },
];

const subject = (code: string, name: string, marks: number, present: number, absent: number, marksSet: Assessment[]): Subject => ({
  code,
  name,
  marks,
  attendance: Math.round((present / (present + absent)) * 100),
  attendance_details: attendance(present, absent),
  assessments: marksSet,
});

const details: StudentDetails = {
  usn: "1MS22IS000",
  name: "Demo Student",
  last_updated: "2026-02-01T10:00:00.000Z",
  current_year: 3,
  subjects: [
    subject("23AL61", "Machine Learning", 39, 28, 2, assessments(40, 42, 9, 10)),
    subject("23IS62", "Computer Networks", 36, 26, 4, assessments(36, 38, 8, 9)),
    subject("23ISL65", "Networks Laboratory", 45, 15, 0, assessments(45, 46, 10, 10)),
    subject("23ISE633", "Cloud Computing", 33, 24, 6, assessments(33, 35, 7, 8)),
    subject("23ISE641", "Information Security", 41, 27, 3, assessments(41, 43, 9, 9)),
  ],
};

const semester = (n: number, sgpa: string, credits: string, courses: [string, string, string][]): ExamHistoryEntry => ({
  semester: `Semester ${n}`,
  sgpa,
  credits_earned: credits,
  courses: courses.map(([code, name, grade]) => ({ code, name, grade })),
});

const examHistory: ExamHistoryEntry[] = [
  semester(1, "8.10", "20", [["23MA11", "Calculus", "A"], ["23PH12", "Physics", "A+"], ["23CS13", "C Programming", "O"]]),
  semester(2, "8.40", "21", [["23MA21", "Linear Algebra", "A"], ["23EE22", "Basic Electronics", "A+"], ["23CS23", "Data Structures", "O"]]),
  semester(3, "8.60", "22", [["23IS31", "Discrete Mathematics", "A+"], ["23IS32", "Digital Design", "A"], ["23IS33", "Object Oriented Programming", "O"]]),
  semester(4, "8.80", "22", [["23IS41", "Operating Systems", "A+"], ["23IS42", "Algorithms", "O"], ["23IS43", "Database Systems", "A"]]),
  semester(5, "8.90", "22", [["23IS51", "Software Engineering", "A+"], ["23IS52", "Theory of Computation", "A"], ["23IS53", "Web Technologies", "O"]]),
];

const DUMMY_STUDENT = {
  usn: "1MS22IS000",
  name: "Demo Student",
  dob: "01-01-2004",
  phone: null,
  email: null,
  currentYear: 3,
  authType: null,
  browserlessTokenValid: false,
  details,
  examHistory,
  cgpa: "8.56",
  examHistoryUpdatedAt: "2026-02-01T10:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-02-01T10:00:00.000Z",
};

export function GET() {
  return NextResponse.json({ success: true, data: DUMMY_STUDENT }, { headers: { "Cache-Control": "no-store" } });
}
