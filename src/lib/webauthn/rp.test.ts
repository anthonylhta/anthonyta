import { describe, expect, it } from "vitest";
import { rpConfig } from "./rp";

const env = (vars: Record<string, string>) =>
  vars as unknown as NodeJS.ProcessEnv;

describe("rpConfig", () => {
  it("is localhost outside Vercel production", () => {
    const rp = rpConfig(env({}));
    expect(rp.rpID).toBe("localhost");
    expect(rp.origins).toContain("http://localhost:3000");
    expect(rp.origins).toContain("http://localhost:3210");
    expect(rp.secure).toBe(false);
  });

  it("stays localhost under a bare production NODE_ENV (the e2e case)", () => {
    // e2e runs the production BUILD via `next start` on localhost:3210 —
    // NODE_ENV alone must never select the prod RP ID.
    const rp = rpConfig(env({ NODE_ENV: "production" }));
    expect(rp.rpID).toBe("localhost");
    expect(rp.secure).toBe(false);
  });

  it("binds to the apex domain in Vercel production", () => {
    const rp = rpConfig(env({ VERCEL_ENV: "production" }));
    expect(rp.rpID).toBe("anthonyta.dev");
    expect(rp.origins).toEqual(["https://anthonyta.dev"]);
    expect(rp.secure).toBe(true);
  });

  it("honors the explicit override pair", () => {
    const rp = rpConfig(
      env({
        WEBAUTHN_RP_ID: "example.dev",
        WEBAUTHN_ORIGIN: "https://example.dev",
      }),
    );
    expect(rp.rpID).toBe("example.dev");
    expect(rp.origins).toEqual(["https://example.dev"]);
    expect(rp.secure).toBe(true);
  });

  it("ignores a half-set override", () => {
    const rp = rpConfig(env({ WEBAUTHN_RP_ID: "example.dev" }));
    expect(rp.rpID).toBe("localhost");
  });
});
