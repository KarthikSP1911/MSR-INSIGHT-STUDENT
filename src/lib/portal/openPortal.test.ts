import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildPortalSignInFields,
  buildPortalSignInPage,
  PORTAL_LOGIN_ACTION,
  PORTAL_SIGNIN_HEADERS,
} from "./openPortal";

const input = {
  usn: "1MS23IS051",
  dob: { dd: "19", mm: "11", yyyy: "2004" },
  authType: "Mother's Mobile",
  pin: "1234",
};

describe("buildPortalSignInFields", () => {
  it("builds what the portal's PIN step posts", () => {
    expect(buildPortalSignInFields(input)).toEqual({
      option: "com_user",
      task: "loginOtp",
      username: "1MS23IS051",
      dd: "19",
      mm: "11",
      yyyy: "2004",
      passwd: "2004-11-19",
      idType: "2",
      enteredid: "1234",
      remember: "No",
    });
  });

  it("maps every verification method to the portal's ID type and tolerates loose spellings", () => {
    const idType = (authType: string) => buildPortalSignInFields({ ...input, authType }).idType;
    expect(idType("Father's Mobile")).toBe("1");
    expect(idType("mother")).toBe("2");
    expect(idType("ABC ID")).toBe("3");
  });

  it("uses the portal's own option values, which may not be zero-padded", () => {
    expect(buildPortalSignInFields({ ...input, dob: { dd: "5", mm: "1", yyyy: "2004" } }).passwd).toBe("2004-1-5");
  });

  it("keeps only digits of the PIN", () => {
    expect(buildPortalSignInFields({ ...input, pin: " 12 34 " }).enteredid).toBe("1234");
  });
});

describe("buildPortalSignInPage", () => {
  const page = buildPortalSignInPage(buildPortalSignInFields(input));

  it("posts every field to the portal's login form", () => {
    expect(page).toContain(`method="post" action="${PORTAL_LOGIN_ACTION}"`);
    expect(PORTAL_LOGIN_ACTION).toBe("https://parents.msrit.edu/newparents/index.php");
    for (const [name, value] of Object.entries(buildPortalSignInFields(input))) {
      expect(page).toContain(`<input type="hidden" name="${name}" value="${value}">`);
    }
  });

  it("submits itself, with a visible button when scripts are blocked", () => {
    expect(page).toContain('document.getElementById("portal-login").submit();');
    expect(page).toMatch(/<noscript><button type="submit">/);
  });

  it("escapes values so a hostile one cannot break out of the attribute", () => {
    const evil = buildPortalSignInPage({ username: `"><script>alert(1)</script>`, note: `a&b'c` });
    expect(evil).not.toContain("<script>alert(1)");
    expect(evil).toContain("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(evil).toContain("a&amp;b&#39;c");
  });
});

describe("PORTAL_SIGNIN_HEADERS", () => {
  const csp = PORTAL_SIGNIN_HEADERS["Content-Security-Policy"];
  const page = buildPortalSignInPage({ a: "b" });

  it("is never cached or leaked", () => {
    expect(PORTAL_SIGNIN_HEADERS["Cache-Control"]).toContain("no-store");
    expect(PORTAL_SIGNIN_HEADERS["Referrer-Policy"]).toBe("no-referrer");
    expect(PORTAL_SIGNIN_HEADERS["X-Robots-Tag"]).toContain("noindex");
  });

  it("lets the page run only its own inline script, and post only to the portal", () => {
    const script = page.match(/<script>([\s\S]*?)<\/script>/)![1];
    const hash = `'sha256-${createHash("sha256").update(script).digest("base64")}'`;
    expect(csp).toContain(`script-src ${hash}`);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("form-action https://parents.msrit.edu");
    expect(csp).toContain("default-src 'none'");
  });

  it("allows exactly the inline stylesheet the page contains", () => {
    const style = page.match(/<style>([\s\S]*?)<\/style>/)![1];
    expect(csp).toContain(`style-src '${`sha256-${createHash("sha256").update(style).digest("base64")}`}'`);
  });
});
