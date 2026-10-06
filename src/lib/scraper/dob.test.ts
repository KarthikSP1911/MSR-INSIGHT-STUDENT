import { describe, expect, it } from "vitest";

import { parseDobParts } from "./dob";

describe("parseDobParts", () => {
  it("parses the DD-MM-YYYY format the login form stores", () => {
    expect(parseDobParts("19-11-2004")).toEqual({ day: "19", month: "11", year: "2004" });
  });

  it("parses YYYY-MM-DD", () => {
    expect(parseDobParts("2004-11-19")).toEqual({ day: "19", month: "11", year: "2004" });
  });

  it("zero-pads single digits and accepts slashes", () => {
    expect(parseDobParts("5/1/2003")).toEqual({ day: "05", month: "01", year: "2003" });
  });

  it("rejects empty and unparseable values", () => {
    expect(() => parseDobParts("")).toThrow(/missing/);
    expect(() => parseDobParts("not a date")).toThrow(/Invalid DOB/);
  });
});
