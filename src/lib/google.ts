import { JWT } from "google-auth-library";

/** Read-only Drive service-account auth, shared by the Drive-backed connectors. */
const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

let jwt: JWT | null = null;
function client(): JWT | null {
  if (jwt) return jwt;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  if (!b64) return null;
  try {
    const j = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    if (!j.client_email || !j.private_key) return null;
    jwt = new JWT({
      email: j.client_email,
      key: j.private_key,
      scopes: SCOPES,
    });
    return jwt;
  } catch {
    return null;
  }
}

/** Bearer token for the Drive service account, or null if it isn't configured. */
export async function driveToken(): Promise<string | null> {
  const c = client();
  if (!c) return null;
  const { token } = await c.getAccessToken();
  return token ?? null;
}
