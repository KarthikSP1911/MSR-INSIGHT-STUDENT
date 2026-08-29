import { z } from "zod";

const usn = z.string().trim().min(1, "USN is required");
const dob = z.string().trim().min(1, "Date of Birth is required");

export const registerSchema = z.object({
  usn,
  dob,
});

export const loginSchema = z.object({
  usn,
  dob,
  authType: z.string().trim().optional(),
  last4Digits: z.string().trim().optional(),
  /** Per-student Browserless.io API token — submitted alongside PIN on secondary auth. */
  browserlessToken: z.string().trim().optional(),
  forceResync: z.boolean().optional(),
});

export const updateSchema = z.object({
  usn,
});
