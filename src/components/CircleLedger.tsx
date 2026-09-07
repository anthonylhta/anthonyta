"use client";

import { useCallback, useEffect, useState } from "react";
import {
  checkSeqAndRemember,
  rememberSavedSeq,
  SeqAlarm,
} from "@/components/SeqAlarm";
import { CIRCLE_CONTEXT } from "@/lib/aevcontext";
import type { AperturePlatformBar } from "@/lib/aperture";
import {
  clearCircle,
  drawCircle,
  EMPTY_CIRCLE,
  meetBar,
  normalizeCircle,
  reconcileCircle,
  type CircleConfig,
} from "@/lib/circlemarks";
import { nextSeq } from "@/lib/seqrule";

/**
 * CircleLedger — `bars spoken`, live: the one bar standing right now, the ones
 * met since the last seal, and the history the seal already carries. The
 * owner's own word, written from the panel the moment it happens and folded in
 * at the check-in (the gu book's marks flow, ADR 0175, under its own envelope).
 *
 * Its own island inside the panel because it OWNS a store: the fetch, the seal,
 * the PUT and the 409 dance all belong to `meta/circle` and to nothing else on
 * the page. Everything above it in the band is the seal read verbatim.
 *
 * THE ONE-AT-A-TIME RULE IS THE STORE'S, not this component's: the draw form is
 * hidden while a bar stands, but `drawCircle` would refuse anyway — the flaw is
 * in the schema so a second surface could not talk its way around it.
 */
export function CircleLedger({
  openItem,
  sealItem,
  sealedAt,
  sealed,
  today,
}: {
  openItem: (
    envelope: Uint8Array,
    context?: string,
  ) => Promise<{ bytes: Uint8Array }>;
  sealItem: (
    meta: { n: string; t: string; s: number },
    bytes: Uint8Array,
    context?: string,
  ) => Promise<Uint8Array>;
  /** The newest seal's instant — what `reconcileCircle` judges an open bar against. */
  sealedAt: string;
  /** The met bars the seal carries. Passed straight off the document so its
   *  identity is stable — the load effect keys on it. */
  sealed: AperturePlatformBar[] | undefined;
  /** The Sydney calendar day, anchored on the server. */
  today: string;
}) {
  const [cfg, setCfg] = useState<CircleConfig | null>(null);
  const [existed, setExisted] = useState(false);
  const [alarm, setAlarm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const put = useCallback(
    async (
      next: CircleConfig,
      prior: CircleConfig,
      had: boolean,
    ): Promise<
      { state: "ok"; written: CircleConfig } | { state: "conflict" | "failed" }
    > => {
      // Bump the sealed write counter (58b); prior = the newer of what was
      // loaded and next itself (a 409-dance rebuild carries the fresher seq).
      const written = {
        ...next,
        seq: Math.max(nextSeq(prior), nextSeq(next)),
      };
      const bytes = new TextEncoder().encode(JSON.stringify(written));
      const envelope = await sealItem(
        { n: "circle.json", t: "application/json", s: bytes.length },
        bytes,
        CIRCLE_CONTEXT,
      );
      const res = await fetch("/api/circle", {
        method: "PUT",
        headers: {
          "content-type": "application/octet-stream",
          ...(had ? { "x-circle-overwrite": "1" } : {}),
        },
        body: new Blob([envelope as BlobPart]),
      });
      if (res.status === 409) return { state: "conflict" };
      if (!res.ok) return { state: "failed" };
      rememberSavedSeq("circle", written);
      return { state: "ok", written };
    },
    [sealItem],
  );

  const load = useCallback(async (): Promise<{
    cfg: CircleConfig;
    existed: boolean;
  }> => {
    const res = await fetch("/api/circle");
    if (res.status === 404) return { cfg: EMPTY_CIRCLE, existed: false };
    if (res.status !== 200) throw new Error(`circle: ${res.status}`);
    const { bytes } = await openItem(
      new Uint8Array(await res.arrayBuffer()),
      CIRCLE_CONTEXT,
    );
    const parsed = normalizeCircle(JSON.parse(new TextDecoder().decode(bytes)));
    if (!parsed) throw new Error("circle: bad shape");
    return { cfg: parsed, existed: true };
  }, [openItem]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let loaded: { cfg: CircleConfig; existed: boolean };
      try {
        loaded = await load();
      } catch {
        if (!cancelled)
          setNotice("the circle is unreachable — reload to retry");
        return;
      }
      if (cancelled) return;
      // Retire what the seal has caught up with. The write-back is best-effort:
      // the page reads the settled record either way.
      const settled = reconcileCircle(loaded.cfg, { sealedAt, circle: sealed });
      setCfg(settled);
      setExisted(loaded.existed);
      void checkSeqAndRemember("circle", loaded.cfg).then((rolled) => {
        if (rolled && !cancelled) setAlarm(true);
      });
      if (settled !== loaded.cfg && loaded.existed)
        void put(settled, loaded.cfg, true).catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, [load, put, sealed, sealedAt]);

  /** Apply a pure transform, seal, PUT — retrying once against a fresh record
   *  on a 409 (the phone and the desk may both have spoken). */
  async function save(
    apply: (base: CircleConfig) => CircleConfig,
  ): Promise<void> {
    if (!cfg) return;
    setBusy(true);
    setNotice(null);
    try {
      let base = cfg;
      let had = existed;
      let r = await put(apply(base), base, had);
      if (r.state === "conflict") {
        const fresh = await load();
        base = reconcileCircle(fresh.cfg, { sealedAt, circle: sealed });
        had = true;
        r = await put(apply(base), base, had);
      }
      if (r.state !== "ok") {
        setNotice("could not save the bar — try again");
        return;
      }
      setCfg(r.written);
      setExisted(true);
    } catch {
      setNotice("could not save the bar — try again");
    } finally {
      setBusy(false);
    }
  }

  // The seal's own history, newest first — sorted here rather than trusted from
  // the emitter, whose order is a writing order.
  const history = (sealed ?? [])
    .filter((b) => b.met !== undefined)
    .sort((a, b) => b.on.localeCompare(a.on));
  const shown = showAll ? history : history.slice(0, 5);

  return (
    <>
      <p className="mt-1.5 text-[10px] uppercase tracking-[0.12em] text-muted/60">
        bars spoken
      </p>
      {alarm && (
        <div className="mt-1.5">
          <SeqAlarm what="circle" />
        </div>
      )}
      {cfg?.open ? (
        <>
          <p className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-muted">
            <span className="text-fg/80">{cfg.open.on}</span>
            <span className="min-w-0 flex-1">· {cfg.open.said}</span>
            <span className="text-muted/60">· due {cfg.open.due}</span>
            <span className="ml-auto flex shrink-0 items-baseline gap-2">
              <button
                type="button"
                onClick={() => void save((b) => meetBar(b, today))}
                disabled={busy}
                className="text-(--essence) hover:text-amber disabled:opacity-50"
              >
                met
              </button>
              <button
                type="button"
                onClick={() => void save(clearCircle)}
                disabled={busy}
                className="text-muted/60 hover:text-amber disabled:opacity-50"
              >
                clear
              </button>
            </span>
          </p>
          <p className="text-[11px] text-muted/50">
            one circle at a time — not redrawn until this bar is met or judged
          </p>
        </>
      ) : (
        cfg !== null && <DrawForm busy={busy} today={today} onDraw={save} />
      )}
      {cfg?.met.map((b) => (
        <p key={`${b.on}|${b.said}`} className="text-[11px] text-muted/60">
          <span className="text-muted/50">{b.on}</span> · {b.said} ·{" "}
          <span className="text-(--essence)">met {b.met}</span>
          <span className="text-muted/50"> · unsealed</span>
        </p>
      ))}
      {shown.map((b) => (
        <p key={`${b.on}|${b.said}`} className="text-[11px] text-muted/60">
          <span className="text-muted/50">{b.on}</span> · {b.said} ·{" "}
          <span className="text-(--essence)">met {b.met}</span>
        </p>
      ))}
      {!showAll && history.length > shown.length && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="self-start text-[11px] text-muted/50 hover:text-amber"
        >
          +{history.length - shown.length} earlier
        </button>
      )}
      {notice && <p className="mt-1 text-[11px] text-amber">{notice}</p>}
    </>
  );
}

/**
 * The draw. One line and one date — a bar is a sentence about his own future
 * action, and the deadline is what makes it one. Hidden entirely while a bar
 * stands, so the form itself never suggests a second circle is available.
 */
function DrawForm({
  busy,
  today,
  onDraw,
}: {
  busy: boolean;
  today: string;
  onDraw: (apply: (base: CircleConfig) => CircleConfig) => Promise<void>;
}) {
  const [said, setSaid] = useState("");
  const [due, setDue] = useState("");
  const valid = said.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(due);
  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!valid || busy) return;
        const bar = { said: said.trim(), on: today, due };
        void onDraw((base) => drawCircle(base, bar)).then(() => {
          setSaid("");
          setDue("");
        });
      }}
      className="mt-0.5 flex flex-wrap items-center gap-2 text-xs"
    >
      <input
        type="text"
        value={said}
        onChange={(ev) => setSaid(ev.target.value)}
        maxLength={400}
        placeholder="a bar — something the record shows you do not do"
        aria-label="the bar"
        className={`min-w-0 flex-1 ${INPUT_CLS}`}
      />
      <input
        type="date"
        value={due}
        min={today}
        onChange={(ev) => setDue(ev.target.value)}
        aria-label="due by"
        className={INPUT_CLS}
      />
      <button type="submit" disabled={busy || !valid} className={BTN_CLS}>
        draw the circle
      </button>
    </form>
  );
}

const INPUT_CLS =
  "border border-hairline bg-transparent px-2 py-1 font-mono text-[13px] text-fg placeholder:text-muted focus:border-amber focus:outline-none disabled:opacity-50";
const BTN_CLS =
  "border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30";
