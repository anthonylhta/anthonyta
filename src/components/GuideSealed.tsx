"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useVault } from "@/app/files/useVault";
import { ExceptionLine } from "@/components/terminal/ExceptionLine";
import { ZoneHeader } from "@/components/terminal/ZoneHeader";
import { APERTURE_CONTEXT } from "@/lib/aevcontext";
import {
  isAdjudicationPending,
  normalizeAperture,
  type ApertureDoc,
} from "@/lib/aperture";
import {
  conditionChipClass,
  conditionChipPrefix,
  conditionStatusWord,
  conditionsSummary,
  detailStatus,
  imminentMajorTrial,
  latestDailyDay,
  splitTrials,
  trialCountdown,
} from "@/lib/apertureview";
import { isVaultIndex, VAULT_INDEX_PATH } from "@/lib/vaultblob";

/**
 * GuideSealed — the summary page's sealed half, as ONE client island: one fetch of
 * the sealed document, one decrypt, one normalize, and the present tense drawn from
 * it. The document rides the E2EE layer, so the server never sees a condition or a
 * trial; sealed dots until the vault is unlocked in this browser (the IDB key cache
 * usually means it already is), and the decrypted document leaves the moment the
 * vault locks.
 *
 * IT DRAWS ONLY WHAT IS TRUE NOW. The wall being worked, the conditions holding it
 * open, and the exception lines — a condition failing, a major tribulation inside
 * the week, a week the seal hasn't caught up with. The paths and their evidence, the
 * trials and the seal history are the READING, and the reading lives on /aperture:
 * the home page stopped being the whole sheet so that a quiet week is a short page.
 *
 * IT STILL OBEYS THE REGISTRY. `sections` is the visible aperture unit keys in the
 * owner's configured order (computed server-side from lib/layout), and this island
 * renders exactly those, in exactly that order. Hiding a band in /system hides it
 * here; reordering it there reorders it here. The island decides nothing about which
 * bands exist — it only knows how to draw each one. (The exception lines are NOT a
 * band: they are the head of the page, and there is no configuration under which an
 * owner wants a failing condition silenced.)
 *
 * The six states it can be in are `apertureview.detailStatus`, not branches invented
 * here. UNKNOWN VOCABULARY RENDERS MUTED, ALWAYS: a status this build has never
 * heard of is printed as its literal in muted type — never dropped (the band would
 * silently shrink), never styled as though it were understood.
 */

/** What each band key is called on its divider, and in the one sealed line. */
const SECTION_LABEL: Record<string, string> = {
  "aperture-wall": "the wall",
  "aperture-conditions": "conditions",
};

/** The decrypted document plus the adjudication rider's one flag. */
interface Loaded {
  doc: ApertureDoc;
  /** Raw journal days have run ≥2 days past the seal — flag, never resolve. */
  pending: boolean;
}

/** Fetch one sealed vault blob's ciphertext through the same-origin owner-gated proxy. */
async function fetchRaw(p: string): Promise<Uint8Array> {
  const res = await fetch(`/api/vault/raw?p=${encodeURIComponent(p)}`);
  if (!res.ok) throw new Error(`vault raw ${p}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Whether the sealed picture is behind the raw journal — the adjudication line.
 * Needs the newest raw day, which lives in the sealed vault index, so it is a SECOND
 * fetch and decrypt. Best-effort by construction: any miss returns false, because a
 * line that can't be computed is a line that shouldn't be shown.
 */
async function adjudicationPending(
  sealedAt: string,
  openItem: (e: Uint8Array, ctx?: string) => Promise<{ bytes: Uint8Array }>,
): Promise<boolean> {
  try {
    const { bytes } = await openItem(await fetchRaw(VAULT_INDEX_PATH));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isVaultIndex(parsed)) return false;
    const latest = latestDailyDay(parsed.notes.map((n) => n.title));
    return isAdjudicationPending(sealedAt, latest);
  } catch {
    return false;
  }
}

export function GuideSealed({
  sections,
  today,
  offline,
}: {
  sections: string[];
  today: string;
  offline: boolean;
}) {
  const { status, openItem } = useVault(offline);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [dataErr, setDataErr] = useState<"unreachable" | "tamper" | null>(null);

  // Render-phase adjustment (not an effect): dropping the decrypted document the
  // moment the vault stops being unlocked, per the lint-blessed reset pattern.
  const unlocked = status === "unlocked";
  const [wasUnlocked, setWasUnlocked] = useState(unlocked);
  if (wasUnlocked !== unlocked) {
    setWasUnlocked(unlocked);
    if (!unlocked) {
      setLoaded(null);
      setDataErr(null);
    }
  }

  useEffect(() => {
    if (status !== "unlocked") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/aperture");
        if (res.status !== 200) {
          // 404 (nothing synced yet) and 503 (a flaky store) both mean the same
          // thing to this island: no document to show, and not the vault's fault.
          if (!cancelled) setDataErr("unreachable");
          return;
        }
        let doc: ApertureDoc;
        try {
          const { bytes } = await openItem(
            new Uint8Array(await res.arrayBuffer()),
            APERTURE_CONTEXT,
          );
          const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
          const next = normalizeAperture(parsed);
          // A decrypted-but-malformed document is indistinguishable from tampering
          // at this trust boundary: the AEAD tag already passed, so the bytes are
          // the ones that were sealed — if their SHAPE is wrong, either the seal
          // or what went into it is not what this build trusts. Same red line.
          if (!next) throw new Error("aperture: bad shape");
          doc = next;
        } catch {
          if (!cancelled) setDataErr("tamper");
          return;
        }
        // The page lands first; the rider only adds one line to it, so it must
        // never hold the document back or be able to fail it.
        if (!cancelled) setLoaded({ doc, pending: false });
        const pending = await adjudicationPending(doc.sealedAt, openItem);
        if (pending && !cancelled) setLoaded({ doc, pending });
      } catch {
        if (!cancelled) setDataErr("unreachable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, openItem]);

  switch (detailStatus(status, dataErr, loaded?.doc ?? null)) {
    case "offline":
      // Store off — the feature is simply absent (DropInbox's precedent). There is
      // no key to want and no door to point at, so pointing at one would be noise.
      return null;

    case "sealed":
      // One honest block for both bands: naming them is the whole content, since
      // what they'd say is exactly what the key is for.
      return (
        <SealedBlock sections={sections}>
          <Link href="/files" className="text-(--essence) hover:underline">
            unlock in files →
          </Link>
        </SealedBlock>
      );

    case "decrypting":
      return <SealedBlock sections={sections}>decrypting…</SealedBlock>;

    case "unreachable":
      return <StatusLine>vault unreachable — reload to retry</StatusLine>;

    case "tamper":
      return <StatusLine>cannot decrypt — lock and unlock</StatusLine>;
  }

  // `ready` — narrowed by the switch above, but TS can't see it through the helper.
  if (!loaded) return null;
  const { conditions, trials, breakthrough } = loaded.doc.sealed;
  // The one trial grave enough to be read at the top of the page rather than in the
  // trials band on /aperture — see `imminentMajorTrial`.
  const { open } = splitTrials(trials);
  const majorTrial = imminentMajorTrial(open, today);
  const majorWhen = majorTrial && trialCountdown(majorTrial.date, today);
  // A failing condition is the one status that must reach the summary in words: the
  // chip below says it too, but a chip is read at the speed of a colour and this is
  // the page's answer to "is anything wrong".
  const failing = conditions.filter((c) => c.status === "failing");
  const hasExceptions =
    failing.length > 0 || majorTrial !== null || loaded.pending;

  /**
   * One band, by its registry key. An unknown key renders nothing — the registry and
   * this table are edited together, and a key with no drawing is not a band. Neither
   * is a band with nothing in it: an empty one returns null rather than a divider
   * over a bordered strip of padding, the same rule the server zones follow.
   */
  const band = (key: string) => {
    switch (key) {
      case "aperture-wall": {
        const strikes = Object.entries(breakthrough.recentStrikes);
        const hasBody =
          breakthrough.event !== "" ||
          breakthrough.routes.length > 0 ||
          strikes.length > 0;
        if (!hasBody && !breakthrough.wall) return null;
        return (
          <>
            <ZoneHeader
              label="the wall"
              seal="壁"
              right={breakthrough.wall || undefined}
            />
            {hasBody && (
              <div className="skin-masonry border-b border-hairline px-4 py-3">
                {breakthrough.event && (
                  <p className="text-sm text-fg">{breakthrough.event}</p>
                )}
                {breakthrough.routes.length > 0 && (
                  <p className="mt-1.5 text-xs text-muted">
                    routes ·{" "}
                    {breakthrough.routes.map((r, i) => (
                      <Fragment key={i}>
                        {i > 0 && " · "}
                        <span className="text-(--essence)">{r}</span>
                      </Fragment>
                    ))}
                  </p>
                )}
                {strikes.length > 0 && (
                  <p className="mt-1 text-xs tabular-nums">
                    <span className="text-muted">strikes this week ·</span>{" "}
                    {strikes.map(([name, n], i) => (
                      <Fragment key={name}>
                        {i > 0 && <span className="text-muted"> · </span>}
                        <span className="text-fg/90">{name}</span>{" "}
                        <span className="text-(--essence)">{n}</span>
                      </Fragment>
                    ))}
                  </p>
                )}
              </div>
            )}
          </>
        );
      }

      case "aperture-conditions":
        if (conditions.length === 0) return null;
        return (
          <>
            <ZoneHeader
              label="conditions"
              seal="律"
              right={conditionsSummary(conditions) || undefined}
            />
            <div className="flex flex-wrap gap-2 border-b border-hairline px-4 py-3">
              {conditions.map((c, i) => (
                <span
                  key={i}
                  className={`inline-flex items-baseline gap-1.5 border px-2 py-0.5 text-xs ${conditionChipClass(c.status)}`}
                >
                  <span className="text-[10px] uppercase tracking-[0.08em]">
                    {conditionChipPrefix(c.status)}
                    {conditionStatusWord(c.status)}
                  </span>
                  <span className="text-fg/90">{c.label}</span>
                  <span className="tabular-nums text-muted">
                    {c.progress}/{c.target}
                  </span>
                </span>
              ))}
            </div>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <>
      {/* the exception band — under the masthead's own line, above every band.
          Nothing firing → nothing at all, which is the whole register: a quiet
          week's summary opens straight into the wall. */}
      {hasExceptions && (
        <div className="px-4 pb-3">
          {failing.map((c, i) => (
            <ExceptionLine key={i} tone="down">
              ⚠ {c.label} — failing
            </ExceptionLine>
          ))}
          {majorTrial && (
            <ExceptionLine tone="down">
              ⚠ {majorTrial.name} · {majorTrial.tier}
              {majorWhen && ` — ${majorWhen}`}
            </ExceptionLine>
          )}
          {loaded.pending && (
            <ExceptionLine tone="amber">
              adjudication pending — seal the week
            </ExceptionLine>
          )}
        </div>
      )}

      {sections.map((key) => (
        <Fragment key={key}>{band(key)}</Fragment>
      ))}
    </>
  );
}

/** The locked / decrypting block: the bands named, the cinnabar 封 pressed over
 *  them ("sealed" is the E2EE vocabulary — the stamp makes it literal), then
 *  whatever comes next. */
function SealedBlock({
  sections,
  children,
}: {
  sections: string[];
  children: ReactNode;
}) {
  const names = sections
    .map((k) => SECTION_LABEL[k])
    .filter((n): n is string => n !== undefined);
  return (
    <div className="relative border-b border-hairline px-4 py-5">
      <p className="pr-20 text-[13px] text-muted/55">
        {names.join(" · ")} <span className="text-muted/40">·····</span>{" "}
        {children}
      </p>
      <span
        aria-hidden
        lang="zh"
        className="skin-stamp absolute right-6 top-1/2 h-14 w-14 -translate-y-1/2 -rotate-6 border-[3px] text-[34px] opacity-75"
      >
        封
      </span>
    </div>
  );
}

/** A one-line failure, in the one colour a failure is allowed. */
function StatusLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-b border-hairline px-4 py-3 text-xs text-down">
      {children}
    </p>
  );
}
