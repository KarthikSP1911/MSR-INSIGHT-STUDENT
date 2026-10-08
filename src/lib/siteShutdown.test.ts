import { afterEach, describe, expect, it, vi } from "vitest";

import { isSiteShutdown } from "./siteShutdown";

describe("isSiteShutdown", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    [undefined, true],
    ["", true],
    ["true", true],
    ["FALSE", true],
    ["0", true],
    ["false", false],
  ])("SITE_SHUTDOWN=%j -> %s", (value, expected) => {
    if (value === undefined) vi.stubEnv("SITE_SHUTDOWN", undefined);
    else vi.stubEnv("SITE_SHUTDOWN", value);
    expect(isSiteShutdown()).toBe(expected);
  });
});
