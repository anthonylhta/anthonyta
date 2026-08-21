import { after } from "next/server";
import {
  categoryOn,
  parsePushConfig,
  pruneSubs,
  pushPayload,
  serializePushConfig,
  type PushCategory,
  type PushConfig,
} from "./push";
import { getPushRaw, putPush } from "./pushstore";

/**
 * pushsend — the impure half of Web Push: env, the `web-push` library, and the
 * store. Every rule worth pinning lives in lib/push; this file is routing and
 * failure-swallowing only.
 *
 * TWO CONTRACTS, both absolute:
 *  - Missing VAPID env = the feature is OFF, silently. No throw, no log spam, no
 *    behaviour change anywhere it is called from. CI and local dev have no keys,
 *    and neither does a fresh deploy before the owner sets them.
 *  - Nothing here ever throws at a caller. A notification is a courtesy; it must
 *    never be able to fail an ingest, a sign-in, or the nightly cron.
 */

/** True only when all three VAPID vars are set — a half-configured pair would
 *  fail every send, so treat it as off rather than as broken. */
export function pushConfigured(): boolean {
  return vapidPublicKey() !== null;
}

/** The VAPID public key, for the /system panel's `pushManager.subscribe`. Not a
 *  secret (it is handed to the browser's push service by design), but returned
 *  only when the whole trio is present so the panel can't offer a subscribe that
 *  could never be sent to. */
export function vapidPublicKey(): string | null {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) return null;
  return pub;
}

/**
 * Load `web-push` and hand it the VAPID trio, or null when the feature is off.
 *
 * The import is deliberately LAZY. `pushAfter` is called from the PUBLIC drop-box
 * ingest, and a top-level import would drag the whole library (and its jws/asn1
 * tail) into that route's cold start — paid by every stranger who posts a
 * message, for a notification that hasn't been sent yet. Loading it inside the
 * send keeps the library off the request path entirely.
 */
async function configure(): Promise<typeof import("web-push") | null> {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) return null;
  try {
    const { default: webpush } = await import("web-push");
    webpush.setVapidDetails(subject, pub, priv);
    return webpush;
  } catch (err) {
    // A malformed key pair, or the library failing to load — off, not broken.
    console.error("[push] vapid setup failed", err);
    return null;
  }
}

/**
 * Send one payload to every device subscribed to `category`. Returns the ids of
 * subscriptions the push service reports as GONE (404/410) so the caller can
 * prune them in the same write it was making anyway; never throws.
 *
 * A 404/410 is the push service saying "this device unsubscribed or the browser
 * dropped it" — permanent, and the only status worth acting on. Every other
 * failure (a 5xx from the vendor, a timeout) is transient and must NOT cost the
 * owner a device: pruning on those would slowly unsubscribe a working phone.
 */
export async function deliver(
  cfg: PushConfig,
  category: PushCategory,
  body: string,
  url = "/",
): Promise<string[]> {
  if (!categoryOn(cfg, category)) return [];
  const webpush = await configure();
  if (!webpush) return [];

  const payload = JSON.stringify(pushPayload(category, body, url));
  const gone: string[] = [];

  await Promise.all(
    cfg.subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          payload,
        );
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          gone.push(sub.id);
          return;
        }
        console.error("[push] send failed", sub.label, status ?? err);
      }
    }),
  );

  return gone;
}

/**
 * The whole fire-and-forget path: load the config, gate on the category, send,
 * and prune dead subscriptions best-effort. Never throws. Used by the inline
 * hooks (drop box, sign-in); the cron drives `deliver` itself so its prune and
 * its episode stamps land in one write.
 */
export async function notify(
  category: PushCategory,
  body: string,
  url = "/",
): Promise<void> {
  try {
    if (!pushConfigured()) return;
    const read = await getPushRaw();
    // absent = nobody has enabled push yet; error = store off or flaky. Both are
    // silence, and neither is worth a retry for a courtesy notification.
    if (read.state !== "ok") return;

    const cfg = parsePushConfig(read.value);
    const gone = await deliver(cfg, category, body, url);
    if (gone.length === 0) return;
    await putPush(serializePushConfig(pruneSubs(cfg, gone)));
  } catch (err) {
    console.error("[push] notify failed", err);
  }
}

/**
 * Queue a notification to run AFTER the response is sent (Next's `after`). Two
 * reasons, and the first is the load-bearing one:
 *
 *  - The public drop-box ingest must not change shape when a push happens. Doing
 *    the send inline would add hundreds of milliseconds to exactly the requests
 *    that stored a message and nothing to the ones that were rejected — a timing
 *    oracle telling a stranger their message landed. `after` keeps the response
 *    identical either way.
 *  - A push failure can then never fail the thing that triggered it.
 *
 * `after` throws outside a request scope; that is caught here so a caller in an
 * unexpected context loses the notification rather than the request.
 */
export function pushAfter(
  category: PushCategory,
  body: string,
  url = "/",
): void {
  try {
    after(() => notify(category, body, url));
  } catch (err) {
    console.error("[push] could not queue", err);
  }
}
