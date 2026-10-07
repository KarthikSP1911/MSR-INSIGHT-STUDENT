/** Parses "DD-MM-YYYY" or "YYYY-MM-DD" (also accepts ISO strings) into portal form-field parts. */
export function parseDobParts(dobString: string): { day: string; month: string; year: string } {
  if (!dobString) {
    throw new Error("Date of Birth is missing or invalid.");
  }

  const parts = dobString.split(/[-/]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      return { day: parts[2].padStart(2, "0"), month: parts[1].padStart(2, "0"), year: parts[0] };
    }
    return { day: parts[0].padStart(2, "0"), month: parts[1].padStart(2, "0"), year: parts[2] };
  }

  const d = new Date(dobString);
  if (!isNaN(d.valueOf())) {
    return {
      day: String(d.getDate()).padStart(2, "0"),
      month: String(d.getMonth() + 1).padStart(2, "0"),
      year: String(d.getFullYear()),
    };
  }

  throw new Error("Invalid DOB format");
}
