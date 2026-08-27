/**
 * Ported from PlacementSection.tsx's inline parsing helpers. The portal's
 * placement pages have no stable structure, so htmlParser.ts's
 * parsePlacementEvents produces loosely-shaped records (either a
 * {title, details[], actionLink} list item, or arbitrary field_N columns
 * from a table fallback) — this module regex-extracts company/type/dates/
 * CTC/status out of whatever text made it through.
 */

import type { RawPlacementEvent } from "@/lib/studentDetails";

export interface ParsedEvent {
  company: string;
  type: string;
  appliedDate: string | null;
  eventDate: string | null;
  ctc: string | null;
  status: string;
  actionLink?: string;
  raw: RawPlacementEvent;
}

export function parseDate(str: string | null | undefined): Date | null {
  if (!str) return null;
  const cleaned = str.replace(/-/g, "/").trim();
  const parts = cleaned.split("/");
  if (parts.length === 3) {
    if (parts[2].length === 4) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);
      return new Date(year, month, day);
    }
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

export interface RelativeDate {
  text: string;
  color: string;
}

/** e.g. "(3 days ago)" or "(19 days left)". */
export function getRelativeDateString(dateStr: string | null): RelativeDate | null {
  if (!dateStr) return null;
  const d = parseDate(dateStr);
  if (!d) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);

  const diffTime = d.getTime() - now.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return { text: "(Today)", color: "var(--accent-primary, #F97316)" };
  } else if (diffDays < 0) {
    const absDays = Math.abs(diffDays);
    return { text: absDays === 1 ? "(1 day ago)" : `(${absDays} days ago)`, color: "#10b981" };
  } else {
    return { text: diffDays === 1 ? "(1 day left)" : `(${diffDays} days left)`, color: "#ef4444" };
  }
}

/** Regex-based extraction of fields from unstructured Contineo scrapings. */
export function parseEventData(event: RawPlacementEvent): ParsedEvent {
  const title = event.title || "";
  let company = title;
  let type = "Placement Event";

  const typeMatch = title.match(/^([^(]+)\(([^)]+)\)/);
  if (typeMatch) {
    company = typeMatch[1].trim();
    type = typeMatch[2].trim();
  } else {
    const text = event.textContent || "";
    const typeLook = text.match(/\b(Service|Product|Core|Direct|Internship)\b/i);
    if (typeLook) {
      type = typeLook[0];
    }
  }

  let appliedDate: string | null = null;
  let eventDate: string | null = null;
  let ctc: string | null = null;
  let status = "Open";

  const allText = [event.title, event.textContent, ...(event.details || [])].join(" ");

  const appliedMatch = allText.match(/(?:Applied\s+On|Applied\s+Date|Applied|Apply\s+Before)[:\s]+([0-9a-zA-Z\s\-/: ]+)/i);
  if (appliedMatch) {
    const rawDate = appliedMatch[1].trim();
    const dateOnlyMatch = rawDate.match(/\b\d{1,2}[-/\s]\d{1,2}[-/\s]\d{4}\b/);
    appliedDate = dateOnlyMatch ? dateOnlyMatch[0] : rawDate.split(/(?:\s{2,}|,|\.|\()/)[0].trim();
  }

  const eventDateMatch = allText.match(/(?:Event\s+Date|Date\s+of\s+Event|Event)[:\s]+([0-9a-zA-Z\s\-/: ]+)/i);
  if (eventDateMatch) {
    const rawDate = eventDateMatch[1].trim();
    const dateOnlyMatch = rawDate.match(/\b\d{1,2}[-/\s]\d{1,2}[-/\s]\d{4}\b/);
    eventDate = dateOnlyMatch ? dateOnlyMatch[0] : rawDate.split(/(?:\s{2,}|,|\.|\()/)[0].trim();
  }

  const ctcMatch = allText.match(/(?:₹?\s*\d+(?:\.\d+)?\s*(?:LPA|Lakhs|L)|CTC[:\s]+₹?\s*\d+(?:\.\d+)?\s*(?:LPA|Lakhs|L))/i);
  if (ctcMatch) {
    ctc = ctcMatch[0].replace(/CTC[:\s]+/i, "").trim();
    if (!ctc.startsWith("₹")) ctc = "₹" + ctc;
  }

  const statusMatch = allText.match(/(?:Status)[:\s]+([a-zA-Z\s]+)/i);
  if (statusMatch) {
    status = statusMatch[1].trim();
  } else {
    if (/under\s*progress/i.test(allText)) status = "Under Progress";
    else if (/registered/i.test(allText)) status = "Registered";
    else if (/eligible/i.test(allText)) status = "Eligible";
    else if (/applied/i.test(allText)) status = "Applied";
    else if (/selected/i.test(allText)) status = "Selected";
    else if (/rejected/i.test(allText)) status = "Rejected";
  }

  return {
    company,
    type,
    appliedDate,
    eventDate,
    ctc,
    status,
    actionLink: event.actionLink,
    raw: event,
  };
}

/** A registration event whose window has closed (explicit "closed" text, or applied-date already past). */
export function isEventExhausted(parsed: ParsedEvent): boolean {
  const statusLower = (parsed.status || "").toLowerCase();
  const rawLower = JSON.stringify(parsed.raw).toLowerCase();
  if (statusLower.includes("closed") || rawLower.includes("registration closed") || rawLower.includes("closed")) {
    return true;
  }
  if (parsed.appliedDate) {
    const d = parseDate(parsed.appliedDate);
    if (d) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      d.setHours(0, 0, 0, 0);
      if (d.getTime() < today.getTime()) {
        return true;
      }
    }
  }
  return false;
}
