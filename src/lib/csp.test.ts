import { describe, expect, it } from "vitest";
import { buildCsp, cspHeaderName } from "./csp";

// name → exact value, split back out of a built policy for table-driven assertions.
const directiveMap = (policy: string): Record<string, string> =>
  Object.fromEntries(
    policy.split(";").map((d) => {
      const t = d.trim();
      const sp = t.indexOf(" ");
      return sp < 0 ? [t, ""] : [t.slice(0, sp), t.slice(sp + 1)];
    }),
  );

describe("buildCsp", () => {
  it("interpolates the nonce exactly once, inside script-src", () => {
    const policy = buildCsp("abc123");
    expect(policy.match(/'nonce-abc123'/g)).toHaveLength(1);
    expect(directiveMap(policy)["script-src"]).toContain("'nonce-abc123'");
  });

  it("emits all 12 directives with their exact values", () => {
    const dirs = directiveMap(buildCsp("abc123"));
    const expected: Record<string, string> = {
      "default-src": "'self'",
      "script-src": "'self' 'nonce-abc123' 'strict-dynamic'",
      "style-src": "'self' 'unsafe-inline'",
      "img-src": "'self' data: https://*.private.blob.vercel-storage.com",
      "font-src": "'self'",
      "connect-src": "'self' https://vercel.com/api/blob/",
      "worker-src": "'self'",
      "object-src": "'none'",
      "base-uri": "'none'",
      "frame-src": "'none'",
      "frame-ancestors": "'none'",
      "form-action": "'self'",
    };
    expect(Object.keys(dirs)).toEqual(Object.keys(expected));
    for (const [name, value] of Object.entries(expected)) {
      expect(dirs[name]).toBe(value);
    }
  });

  it("adds 'unsafe-eval' to script-src only in dev, and nowhere without it", () => {
    const dev = buildCsp("abc123", { dev: true });
    expect(directiveMap(dev)["script-src"]).toBe(
      "'self' 'nonce-abc123' 'strict-dynamic' 'unsafe-eval'",
    );
    // Prod build never carries the token at all.
    expect(buildCsp("abc123")).not.toContain("unsafe-eval");
    expect(buildCsp("abc123", { dev: false })).not.toContain("unsafe-eval");
  });

  it("has no doubled separators and no stray whitespace per directive", () => {
    for (const policy of [
      buildCsp("abc123"),
      buildCsp("abc123", { dev: true }),
    ]) {
      expect(policy).not.toContain(";;");
      expect(policy).toBe(policy.trim());
      for (const d of policy.split("; ")) expect(d).toBe(d.trim());
    }
  });
});

describe("cspHeaderName", () => {
  it("flips on the enforce flag", () => {
    expect(cspHeaderName(true)).toBe("Content-Security-Policy");
    expect(cspHeaderName(false)).toBe("Content-Security-Policy-Report-Only");
  });
});
