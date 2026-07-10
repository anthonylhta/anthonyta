import { SITE_URL } from "@/lib/site";

/**
 * WebAuthn relying-party identity. Passkeys bind to the RP ID's domain, so this
 * is pinned per environment rather than derived from the request Host (which
 * `trustHost` makes spoofable): production is the apex domain, everything else
 * is localhost — covering `next dev` (:3000) and the e2e `next start` (:3210).
 *
 * VERCEL_ENV, not NODE_ENV, decides "production": the e2e suite runs the
 * production BUILD on localhost, where a prod RP ID would break every ceremony.
 * `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` exist as explicit escape hatches (they
 * also aid debugging an RP-ID mismatch, whose symptoms are an instantly-empty
 * passkey sheet client-side or a verify failure server-side). Vercel preview
 * deploys get the localhost RP ID, so passkeys simply don't match there —
 * accepted: previews have no owner surface worth signing into.
 */
export const RP_NAME = "anthony ta";

export interface RpConfig {
  rpID: string;
  /** Every origin an assertion may legitimately come from (dev + e2e ports). */
  origins: string[];
  /** Whether the challenge cookie may carry `Secure` (https origins only). */
  secure: boolean;
}

export function rpConfig(env: NodeJS.ProcessEnv = process.env): RpConfig {
  const idOverride = env.WEBAUTHN_RP_ID;
  const originOverride = env.WEBAUTHN_ORIGIN;
  if (idOverride && originOverride) {
    return {
      rpID: idOverride,
      origins: [originOverride],
      secure: originOverride.startsWith("https:"),
    };
  }
  if (env.VERCEL_ENV === "production") {
    return {
      rpID: new URL(SITE_URL).hostname,
      origins: [SITE_URL],
      secure: true,
    };
  }
  return {
    rpID: "localhost",
    origins: ["http://localhost:3000", "http://localhost:3210"],
    secure: false,
  };
}
