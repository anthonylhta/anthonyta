"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVault } from "@/app/files/useVault";
import {
  codeAt,
  isTotpConfig,
  parseOtpauth,
  secondsLeft,
  toOtpauth,
  type TotpConfig,
  type TotpEntry,
} from "@/lib/totp";
import { TOTP_CONTEXT } from "@/lib/aevcontext";

/**
 * The TOTP drawer (ADR: TOTP drawer) — two-factor codes computed in the browser
 * from seeds sealed in the vault. The seeds are the crown jewels of 2FA
 * (whoever holds them mints valid codes forever): they live in ONE AEV envelope
 * at `meta/totp`, decrypt only behind the unlock (one PRF tap), and neither a
 * seed nor a code ever reaches the server. Locked → a one-line nudge, the
 * FinPanel idiom; the drawer renders nothing at all when the store is off.
 *
 * Add flow: paste an `otpauth://` URI (what authenticator exports carry) or a
 * bare base32 seed; the parsed entry shows a LIVE code before it's saved — the
 * "does it match your phone" sanity check. Export hands the URIs back while
 * unlocked: lock-in is the phone app's failure, not a feature to copy.
 */

const input =
  "border border-hairline bg-transparent px-2 py-1 font-mono text-[13px] text-fg placeholder:text-muted focus:border-amber focus:outline-none disabled:opacity-50";
const btn =
  "border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30";

/** Codes are secrets with a 30-second half-life; the clipboard clear is a
 *  best-effort courtesy (a focus change can beat it) — the short code lifetime
 *  is the real bound. */
const CLIPBOARD_CLEAR_MS = 30_000;

type Load = "loading" | "ready" | "unreachable" | "tamper";

export function TotpDrawer({ offline }: { offline: boolean }) {
  const vault = useVault(offline);
  const { openItem } = vault;
  const unlocked = vault.status === "unlocked";

  const [cfg, setCfg] = useState<TotpConfig | null>(null);
  const [load, setLoad] = useState<Load>("loading");
  const [existed, setExisted] = useState(false);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Render-phase reset on the lock/unlock edge (the lint-blessed pattern).
  const [prevUnlocked, setPrevUnlocked] = useState(unlocked);
  if (prevUnlocked !== unlocked) {
    setPrevUnlocked(unlocked);
    setCfg(null);
    setLoad("loading");
    setErr(null);
  }

  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    (async () => {
      let res: Response;
      try {
        res = await fetch("/api/totp");
      } catch {
        if (!cancelled) setLoad("unreachable");
        return;
      }
      if (res.status === 404) {
        // A healthy empty drawer — first entry arms it.
        if (!cancelled) {
          setCfg({ v: 1, entries: [] });
          setExisted(false);
          setLoad("ready");
        }
        return;
      }
      if (res.status !== 200) {
        if (!cancelled) setLoad("unreachable");
        return;
      }
      try {
        const { bytes } = await openItem(
          new Uint8Array(await res.arrayBuffer()),
          TOTP_CONTEXT,
        );
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (!isTotpConfig(parsed)) throw new Error("bad shape");
        if (!cancelled) {
          setCfg(parsed);
          setExisted(true);
          setLoad("ready");
        }
      } catch {
        if (!cancelled) setLoad("tamper");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem]);

  /** Seal + PUT the whole config — no-clobber on the very first write. */
  const save = useCallback(
    async (next: TotpConfig): Promise<boolean> => {
      const json = new TextEncoder().encode(JSON.stringify(next));
      const sealed = await vault.sealItem(
        { n: "totp", t: "application/json", s: json.length },
        json,
        TOTP_CONTEXT,
      );
      const res = await fetch("/api/totp", {
        method: "PUT",
        body: sealed.slice().buffer as ArrayBuffer,
        headers: existed ? { "x-totp-overwrite": "1" } : {},
      });
      if (res.status === 409) {
        setErr("the drawer changed elsewhere — reload and retry");
        return false;
      }
      if (!res.ok) {
        setErr("save failed — nothing was written");
        return false;
      }
      setCfg(next);
      setExisted(true);
      setErr(null);
      return true;
    },
    [vault, existed],
  );

  if (vault.status === "offline") return null;
  if (!unlocked)
    return (
      <p className="text-xs text-muted">
        2fa codes unlock with the vault — unlock in files/ or tap a passkey.
      </p>
    );
  if (load === "loading") return <p className="text-xs text-muted">…</p>;
  if (load === "unreachable")
    return <p className="text-xs text-down">totp store unreachable</p>;
  if (load === "tamper")
    return (
      <p className="text-xs text-down">cannot decrypt — lock and unlock</p>
    );
  if (!cfg) return null;

  return (
    <div className="text-xs">
      {cfg.entries.length === 0 && !adding && (
        <p className="text-muted">no seeds yet — add one from a QR export.</p>
      )}
      <ul className="space-y-1.5">
        {cfg.entries.map((e, i) => (
          <CodeRow
            key={`${e.issuer}:${e.account}:${i}`}
            entry={e}
            onRemove={() =>
              save({
                v: 1,
                entries: cfg.entries.filter((_, j) => j !== i),
              })
            }
          />
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-3">
        {adding ? (
          <AddForm
            onCancel={() => setAdding(false)}
            onSave={async (entry) => {
              const ok = await save({ v: 1, entries: [...cfg.entries, entry] });
              if (ok) setAdding(false);
            }}
          />
        ) : (
          <>
            <button
              type="button"
              className={btn}
              onClick={() => setAdding(true)}
            >
              [add]
            </button>
            {cfg.entries.length > 0 && (
              <button
                type="button"
                className={btn}
                onClick={() =>
                  navigator.clipboard.writeText(
                    cfg.entries.map(toOtpauth).join("\n"),
                  )
                }
              >
                [export uris]
              </button>
            )}
          </>
        )}
      </div>
      {err && <p className="mt-2 text-down">{err}</p>}
    </div>
  );
}

/** One live code: issuer/account, the ticking code, a countdown, copy. */
function CodeRow({
  entry,
  onRemove,
}: {
  entry: TotpEntry;
  onRemove: () => void;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const now = Date.now();
      const c = await codeAt(entry, now);
      if (!cancelled) {
        setCode(c);
        setLeft(secondsLeft(entry, now));
      }
    };
    void tick();
    const id = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [entry]);

  const copy = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => {
      // Best-effort: only clear if the clipboard still holds OUR code.
      void navigator.clipboard.readText().then(
        (t) => {
          if (t === code) void navigator.clipboard.writeText("");
        },
        () => {},
      );
    }, CLIPBOARD_CLEAR_MS);
  };

  return (
    <li className="flex items-center gap-3">
      <span className="w-40 min-w-0 shrink-0 truncate text-muted">
        {entry.issuer}
        {entry.account ? ` · ${entry.account}` : ""}
      </span>
      {code === null ? (
        <span className="text-down">bad seed</span>
      ) : (
        <button
          type="button"
          onClick={copy}
          title="copy (clipboard clears in 30s)"
          className="tabular-nums text-lg tracking-[0.2em] text-amber hover:underline"
        >
          {code}
        </button>
      )}
      <span className="w-8 tabular-nums text-muted/70">{left}s</span>
      <button
        type="button"
        onClick={onRemove}
        className="text-muted/60 transition-colors hover:text-down"
      >
        [rm]
      </button>
    </li>
  );
}

/** Paste an otpauth:// URI or a bare base32 seed; the live preview code is the
 *  "does it match your phone" check — nothing is written until [save]. */
function AddForm({
  onSave,
  onCancel,
}: {
  onSave: (e: TotpEntry) => Promise<void>;
  onCancel: () => void;
}) {
  const [raw, setRaw] = useState("");
  const [issuer, setIssuer] = useState("");
  const [preview, setPreview] = useState<string | null>(null);

  const entry: TotpEntry | null = (() => {
    const t = raw.trim();
    if (!t) return null;
    const parsed = parseOtpauth(t);
    if (parsed) return parsed;
    // A bare base32 seed with defaults; the issuer field names it.
    if (!/^[A-Za-z2-7 =-]+$/.test(t)) return null;
    return {
      issuer: issuer || "unnamed",
      account: "",
      secret_b32: t,
      algo: "SHA-1",
      digits: 6,
      period: 30,
    };
  })();

  // Only the async resolve writes state; the render below gates the display on
  // `entry`, so a stale preview from a prior seed never shows for an invalid one.
  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    void codeAt(entry, Date.now()).then(
      (c) => {
        if (!cancelled) setPreview(c);
      },
      () => {
        if (!cancelled) setPreview(null);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- entry is derived from raw+issuer
  }, [raw, issuer]);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <input
        type="text"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder="otpauth://totp/… or a bare base32 seed"
        className={input}
        autoFocus
      />
      {entry && !parseOtpauth(raw.trim()) && (
        <input
          type="text"
          value={issuer}
          onChange={(e) => setIssuer(e.target.value)}
          placeholder="issuer (names a bare seed)"
          className={input}
        />
      )}
      <div className="flex items-center gap-3">
        <span className="tabular-nums text-muted">
          {entry && preview
            ? `preview ${preview} — check it matches your phone`
            : raw.trim()
              ? "unreadable seed"
              : ""}
        </span>
        <button
          type="button"
          className={btn}
          disabled={!entry || !preview}
          onClick={() => entry && onSave(entry)}
        >
          [save]
        </button>
        <button type="button" className={btn} onClick={onCancel}>
          [cancel]
        </button>
      </div>
    </div>
  );
}
