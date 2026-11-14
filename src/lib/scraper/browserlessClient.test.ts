import { describe, expect, it, vi } from "vitest";

import { BrowserlessTokenInvalidError, buildBrowserlessEndpoint, loginToPortalWithBrowserless } from "./browserlessClient";
import { PortalAuthError, PortalUnavailableError } from "./portalHttpClient";

const input = { usn: "1MS23IS051", day: "19", month: "11", year: "2004", authType: "Mother's Mobile", pin: "1234" };
const DASHBOARD = "<html><a href='logout.php'>LOGOUT</a><table></table></html>";
const LOGIN_ERROR = "<html>Invalid credentials <a>LOGOUT</a></html>";

/** A fake Chromium: `pages` is the sequence of {url, html} the portal shows after each submit. */
function fakeBrowser(pages: { url: string; html: string }[], opts: { gotoFails?: boolean; status?: number } = {}) {
  let step = 0;
  const page = {
    setUserAgent: vi.fn(async (_ua: string) => {}),
    setRequestInterception: vi.fn(async () => {}),
    on: vi.fn(),
    goto: vi.fn(async () => {
      if (opts.gotoFails) throw new Error("net::ERR_TIMED_OUT");
      return { status: () => opts.status ?? 200 };
    }),
    type: vi.fn(async () => {}),
    evaluate: vi.fn(async () => {
      step = Math.min(step + 1, pages.length);
    }),
    waitForNavigation: vi.fn(async () => {}),
    waitForSelector: vi.fn(async () => {}),
    $: vi.fn(async () => null),
    url: () => pages[Math.max(0, Math.min(step, pages.length) - 1)]?.url ?? "https://parents.msrit.edu/newparents/",
    content: async () => pages[Math.max(0, Math.min(step, pages.length) - 1)]?.html ?? "<html></html>",
    cookies: vi.fn(async () => [{ name: "PHPSESSID", value: "abc" }, { name: "x", value: "y" }]),
  };
  const browser = { newPage: vi.fn(async () => page), close: vi.fn(async () => {}) };
  return { browser, page, connect: vi.fn(async () => browser) as never };
}

describe("buildBrowserlessEndpoint", () => {
  it("puts the URL-encoded token on the Browserless websocket URL", () => {
    expect(buildBrowserlessEndpoint("a b&c")).toBe("wss://chrome.browserless.io?token=a%20b%26c");
  });
});

describe("loginToPortalWithBrowserless", () => {
  it("returns the dashboard and the session cookie, and closes the remote browser", async () => {
    const { browser, connect } = fakeBrowser([
      { url: "https://parents.msrit.edu/newparents/index.php?dashboard", html: DASHBOARD },
    ]);

    const result = await loginToPortalWithBrowserless(input, "tok", { connect });

    expect(connect).toHaveBeenCalledWith({ browserWSEndpoint: "wss://chrome.browserless.io?token=tok" });
    expect(result.dashboardHtml).toBe(DASHBOARD);
    expect(result.cookieString).toBe("PHPSESSID=abc; x=y");
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it("presents as an ordinary Chrome, because the portal 403s Browserless's HeadlessChrome", async () => {
    const { page, connect } = fakeBrowser([
      { url: "https://parents.msrit.edu/newparents/index.php?dashboard", html: DASHBOARD },
    ]);

    await loginToPortalWithBrowserless(input, "tok", { connect });

    const ua = page.setUserAgent.mock.calls[0][0];
    expect(ua).toMatch(/^Mozilla\/5\.0 .*Chrome\/\d+.* Safari/);
    expect(ua).not.toMatch(/Headless/);
  });

  it("reports a 403 from the portal as a block (an outage), not an unknown error", async () => {
    const { browser, page, connect } = fakeBrowser([], { status: 403 });

    await expect(loginToPortalWithBrowserless(input, "tok", { connect })).rejects.toThrow(/blocked the remote browser/);
    expect(page.type).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it("throws BrowserlessTokenInvalidError when Browserless can't be connected to", async () => {
    const connect = vi.fn(async () => {
      throw new Error("401 Unauthorized");
    }) as never;

    await expect(loginToPortalWithBrowserless(input, "bad", { connect })).rejects.toBeInstanceOf(BrowserlessTokenInvalidError);
  });

  it("throws PortalAuthError for the portal's login-error page, even though it contains LOGOUT", async () => {
    const { browser, connect } = fakeBrowser([{ url: "https://parents.msrit.edu/newparents/", html: LOGIN_ERROR }]);

    await expect(loginToPortalWithBrowserless(input, "tok", { connect })).rejects.toBeInstanceOf(PortalAuthError);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it("reports an unreachable portal as an outage, not a bad token or bad credentials", async () => {
    const { browser, connect } = fakeBrowser([], { gotoFails: true });

    await expect(loginToPortalWithBrowserless(input, "tok", { connect })).rejects.toBeInstanceOf(PortalUnavailableError);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it("gives up at the deadline and still closes the browser", async () => {
    const { browser, page, connect } = fakeBrowser([]);
    page.goto.mockImplementation(() => new Promise(() => {}));

    await expect(loginToPortalWithBrowserless(input, "tok", { connect, deadlineMs: 20 })).rejects.toBeInstanceOf(PortalUnavailableError);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });
});
