import { describe, expect, it } from "vitest";

import { classifyScrapeFailure } from "./failureKind";
import { PortalAuthError, PortalLoginUnsupportedError, PortalUnavailableError } from "./portalHttpClient";

describe("classifyScrapeFailure", () => {
  it("treats an unreachable or erroring portal as an outage", () => {
    expect(classifyScrapeFailure(new PortalUnavailableError())).toBe("portal_unavailable");
  });

  it("treats a login page this client can no longer replay as an outage, not a student error", () => {
    expect(classifyScrapeFailure(new PortalLoginUnsupportedError())).toBe("portal_unavailable");
  });

  it("keeps rejected credentials separate from an outage", () => {
    expect(classifyScrapeFailure(new PortalAuthError())).toBe("credentials_rejected");
  });

  it("falls back to 'other' for anything unexpected", () => {
    expect(classifyScrapeFailure(new Error("boom"))).toBe("other");
    expect(classifyScrapeFailure("not even an error")).toBe("other");
  });
});
