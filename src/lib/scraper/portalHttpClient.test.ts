import * as cheerio from "cheerio";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  collectFormFields,
  fetchDobSelectValues,
  findCsrfFieldName,
  loginToPortal,
  PortalAuthError,
  PortalLoginUnsupportedError,
  PortalUnavailableError,
  pickSelectValue,
  type PortalLoginInput,
} from "./portalHttpClient";

const CSRF_1 = "a1aa42becbca72274e23229a3b732392";
const CSRF_2 = "0123456789abcdef0123456789abcdef";

const options = (values: string[]) => values.map((v) => `<option value="${v}">${v}</option>`).join("");

const LOGIN_PAGE = `
<html><body>
<form action="index.php" method="POST" name="log"><input type="hidden" name="task" value="logout"></form>
<form id="login-form" action="index.php" method="post">
  <input type="text" name="username" id="username">
  <select name="dd" id="dd"><option value="">Day</option>${options(["05", "19"])}</select>
  <select name="mm" id="mm"><option value="">Month</option>${options(["01", "11"])}</select>
  <select name="yyyy" id="yyyy"><option value="">Year</option>${options(["2003", "2004"])}</select>
  <input type="hidden" name="passwd" id="passwd">
  <input type="hidden" name="remember" id="remember" value="No">
  <input type="submit" value="Login" onclick="return check1()">
  <input type="hidden" name="option" value="com_user">
  <input type="hidden" name="task" value="loginOtp">
  <input type="hidden" name="return" value="">
  <input type="hidden" name="${CSRF_1}" value="1">
  <input type="hidden" id="captcha-response" name="captcha-response">
</form></body></html>`;

const PIN_PAGE = `
<html><body><form id="login-form" action="index.php" method="post">
  <select id="id-type-select" name="idType"><option value="">Select</option><option value="1">Father</option><option value="2">Mother</option><option value="3">ABC</option></select>
  <input type="text" class="digit-input"><input type="text" class="digit-input"><input type="text" class="digit-input"><input type="text" class="digit-input">
  <input type="hidden" name="enteredid" id="enteredid">
  <input type="hidden" name="remember" value="No">
  <input type="hidden" name="option" value="com_user">
  <input type="hidden" name="task" value="loginOtp">
  <input type="hidden" name="username" value="1MS23IS051">
  <input type="hidden" name="passwd" value="2004-11-19">
  <input type="hidden" name="${CSRF_2}" value="1">
  <button type="submit" id="btn-submit">Verify</button>
</form></body></html>`;

const DASHBOARD_PAGE = `
<html><body><a href="index.php?option=com_user&task=logout">LOGOUT</a>
<table><tbody><tr><td>23IS62</td><td>Software Engineering</td>
<td><a href="index.php?option=com_attendance&task=attendencelist&id=1">att</a></td></tr></tbody></table></body></html>`;

const LOGIN_FAILED_PAGE = `${LOGIN_PAGE.replace("</body>", "<p class=\"error\">Username does not exist</p></body>")}`;

interface RecordedRequest {
  method: string;
  url: string;
  form: Record<string, string>;
  cookie: string;
}

/** A tiny fake of the portal's redirect + cookie behaviour, enough to drive loginToPortal end to end. */
function fakePortal(pages: { stage1: string; pin?: string }) {
  const requests: RecordedRequest[] = [];
  const html = (body: string, cookie?: string) => {
    const headers = new Headers({ "content-type": "text/html" });
    if (cookie) headers.append("set-cookie", `${cookie}; path=/; secure`);
    return new Response(body, { status: 200, headers });
  };
  const redirect = (location: string, cookie?: string) => {
    const headers = new Headers({ location });
    if (cookie) headers.append("set-cookie", `${cookie}; path=/; secure`);
    return new Response(null, { status: 303, headers });
  };

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const form = Object.fromEntries(new URLSearchParams(String(init?.body ?? "")));
    requests.push({ method, url, form, cookie: new Headers(init?.headers).get("cookie") ?? "" });

    if (method === "GET" && url.endsWith("/newparents/")) return redirect("https://parents.msrit.edu/newparents/index.php", "sess=one");
    if (method === "GET" && url.endsWith("index.php")) return html(LOGIN_PAGE);
    if (method === "POST" && "enteredid" in form) {
      return form.enteredid === "1234" && form.idType === "2"
        ? redirect("index.php?option=com_dashboard&task=ksign", "sess=two")
        : html(pages.pin ?? PIN_PAGE);
    }
    if (method === "POST") return html(pages.stage1);
    if (method === "GET" && url.includes("ksign")) return html(DASHBOARD_PAGE);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  return { fetchImpl, requests };
}

const input: PortalLoginInput = {
  usn: "1MS23IS051",
  day: "19",
  month: "11",
  year: "2004",
  authType: "Mother's Mobile",
  pin: "1234",
};

describe("loginToPortal", () => {
  it("replays both login steps and returns the dashboard with the session cookie", async () => {
    const { fetchImpl, requests } = fakePortal({ stage1: PIN_PAGE });
    const progress: string[] = [];

    const result = await loginToPortal(input, { fetchImpl, onProgress: async (m) => void progress.push(m) });

    expect(result.dashboardHtml).toContain("attendencelist");
    expect(result.cookieString).toBe("sess=two");
    expect(result.requestCount).toBe(5);
    expect(progress).toHaveLength(3);

    const stage1 = requests.find((r) => r.method === "POST" && "passwd" in r.form && !("enteredid" in r.form))!;
    expect(stage1.form).toMatchObject({
      username: "1MS23IS051",
      dd: "19",
      mm: "11",
      yyyy: "2004",
      passwd: "2004-11-19",
      "captcha-response": "",
      option: "com_user",
      task: "loginOtp",
      [CSRF_1]: "1",
    });
    expect(stage1.cookie).toBe("sess=one");

    const pinStep = requests.find((r) => "enteredid" in r.form)!;
    expect(pinStep.form).toMatchObject({ idType: "2", enteredid: "1234", [CSRF_2]: "1", username: "1MS23IS051" });
  });

  it("returns right away when the first step already lands on the dashboard", async () => {
    const { fetchImpl } = fakePortal({ stage1: DASHBOARD_PAGE });
    const result = await loginToPortal(input, { fetchImpl });
    expect(result.pinMs).toBe(0);
    expect(result.dashboardHtml).toContain("attendencelist");
  });

  it("throws PortalAuthError when the PIN is rejected", async () => {
    const { fetchImpl } = fakePortal({ stage1: PIN_PAGE });
    await expect(loginToPortal({ ...input, pin: "9999" }, { fetchImpl })).rejects.toBeInstanceOf(PortalAuthError);
  });

  it("throws PortalAuthError with a student-safe message when the USN or DOB is rejected", async () => {
    const { fetchImpl } = fakePortal({ stage1: LOGIN_FAILED_PAGE });
    await expect(loginToPortal(input, { fetchImpl })).rejects.toThrow(/Invalid portal credentials/);
  });

  it("throws PortalLoginUnsupportedError when the login form is missing", async () => {
    const fetchImpl = (async () => new Response("<html><body>maintenance</body></html>", { status: 200 })) as typeof fetch;
    await expect(loginToPortal(input, { fetchImpl })).rejects.toBeInstanceOf(PortalLoginUnsupportedError);
  });

  it("throws PortalLoginUnsupportedError when the CSRF field is missing", async () => {
    const page = LOGIN_PAGE.replace(`name="${CSRF_1}"`, 'name="not-a-token"');
    const fetchImpl = (async () => new Response(page, { status: 200 })) as typeof fetch;
    await expect(loginToPortal(input, { fetchImpl })).rejects.toBeInstanceOf(PortalLoginUnsupportedError);
  });

  it("throws PortalUnavailableError when the portal answers with a server error", async () => {
    const fetchImpl = (async () => new Response("Service Unavailable", { status: 503 })) as typeof fetch;
    await expect(loginToPortal(input, { fetchImpl })).rejects.toBeInstanceOf(PortalUnavailableError);
  });

  it("throws PortalUnavailableError when the portal cannot be reached at all", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(loginToPortal(input, { fetchImpl })).rejects.toBeInstanceOf(PortalUnavailableError);
  });

  it("fails cleanly once the overall deadline has passed", async () => {
    const { fetchImpl } = fakePortal({ stage1: PIN_PAGE });
    await expect(loginToPortal(input, { fetchImpl, deadlineMs: -1 })).rejects.toThrow(/timed out/);
  });
});

describe("site shutdown", () => {
  afterEach(() => {
    vi.stubEnv("SITE_SHUTDOWN", "false");
  });

  it("never sends a request to the portal while the site is paused", async () => {
    vi.stubEnv("SITE_SHUTDOWN", "true");
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(loginToPortal(input, { fetchImpl })).rejects.toBeInstanceOf(PortalLoginUnsupportedError);
    await expect(fetchDobSelectValues(input, fetchImpl)).rejects.toBeInstanceOf(PortalLoginUnsupportedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("form helpers", () => {
  it("finds the 32-hex CSRF field and ignores look-alikes", () => {
    expect(findCsrfFieldName({ username: "", [CSRF_1]: "1" })).toBe(CSRF_1);
    expect(findCsrfFieldName({ [CSRF_1]: "0" })).toBeNull();
    expect(findCsrfFieldName({ abc: "1" })).toBeNull();
  });

  it("collects what a browser would submit and skips buttons and unchecked boxes", () => {
    const $ = cheerio.load(`<form><input name="a" value="1"><input name="b"><input type="submit" name="s" value="x">
      <input type="checkbox" name="c" value="y"><input type="checkbox" name="d" value="z" checked></form>`);
    expect(collectFormFields($, $("form"))).toEqual({ a: "1", b: "", d: "z" });
  });

  it("matches select options by value, numeric value or label", () => {
    const $ = cheerio.load(`<select id="dd"><option value="05">5th</option><option value="19">19</option></select>`);
    expect(pickSelectValue($, "dd", "5")).toBe("05");
    expect(pickSelectValue($, "dd", "05")).toBe("05");
    expect(pickSelectValue($, "dd", "19")).toBe("19");
    expect(pickSelectValue($, "dd", "31")).toBe("31");
  });
});
