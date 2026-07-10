"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Sparkline } from "@/components/terminal/Sparkline";
import {
  boxOpen,
  fromB64url,
  generateBoxKeypair,
  importBoxPriv,
  isSnapkey,
  toB64url,
  type Snapkey,
} from "@/lib/crypto";
import {
  buildNetWorthSeries,
  isFinConfig,
  isSnapBoxPayload,
  latestEntry,
  sydneyToday,
  upsertEntry,
  type FinConfig,
  type FinEntry,
  type NetWorthPoint,
  type SnapBoxPayload,
} from "@/lib/fin";
import { arrow, aud, tone } from "@/lib/money";
import { useVault, type Vault } from "@/app/files/useVault";

// Shared input/button idioms, lifted from FilesInbox's panels.
const input =
  "border border-hairline bg-transparent px-2 py-1 font-mono text-[13px] text-fg placeholder:text-muted focus:border-amber focus:outline-none disabled:opacity-50";
const btn =
  "border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30";

const UNREACHABLE =
  "vault unreachable — reload to retry (your key is untouched)";
const TAMPER = "cannot decrypt — lock and unlock";

/**
 * The E2EE finance panel: net worth + holdings + the sealed cash/HISA config, all
 * behind the same master key the files vault owns (there is one setup flow, one MK).
 * The server never sees a plaintext balance — the config envelope and the nightly
 * snapshot boxes decrypt here, on the client, only while the vault is unlocked.
 */
export function FinPanel({
  invested,
  offline,
  holdings,
}: {
  invested: number;
  offline: boolean;
  holdings: ReactNode;
}) {
  const vault = useVault(offline);
  const { openItem } = vault;
  const unlocked = vault.status === "unlocked";

  // Decrypted data (unlocked only).
  const [cfg, setCfg] = useState<FinConfig | null>(null);
  const [configExisted, setConfigExisted] = useState(false);
  const [dataErr, setDataErr] = useState<"unreachable" | "tamper" | null>(null);
  const [snapkeyAbsent, setSnapkeyAbsent] = useState(false);
  const [payloads, setPayloads] = useState<SnapBoxPayload[]>([]);
  const [trendNote, setTrendNote] = useState<string | null>(null);
  const [justEnabled, setJustEnabled] = useState(false);
  const [editing, setEditing] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [enableErr, setEnableErr] = useState(false);

  // Render-phase adjustment (not an effect): reset the per-unlock state on the
  // lock/unlock edge, per the lint-blessed reset pattern.
  const [prevUnlocked, setPrevUnlocked] = useState(unlocked);
  if (prevUnlocked !== unlocked) {
    setPrevUnlocked(unlocked);
    setDataErr(null);
    setCfg(null);
    setSnapkeyAbsent(false);
    setPayloads([]);
    setTrendNote(null);
    setJustEnabled(false);
    setEditing(false);
  }

  // Load + decrypt once per unlock. A cancelled flag drops a late resolve after
  // lock/unmount. `openItem` is a stable callback, so [unlocked, openItem] fires
  // exactly on the lock→unlock edge, never on the working-flag flicker.
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;

    (async () => {
      // One round-trip each, fired together.
      const [cfgR, skR, snapR] = await Promise.allSettled([
        fetch("/api/fin/config"),
        fetch("/api/fin/snapkey"),
        fetch("/api/fin/snapshots?days=30"),
      ]);

      // config — a flake must never read as an empty (re-seedable) editor, so
      // 503/network → the unreachable banner, only a healthy 404 → fresh config.
      let config: FinConfig | null = null;
      let existed = false;
      if (cfgR.status === "rejected") {
        if (!cancelled) setDataErr("unreachable");
        return;
      }
      const cfgRes = cfgR.value;
      if (cfgRes.status === 404) {
        config = { v: 1, entries: [] };
      } else if (cfgRes.status === 200) {
        try {
          const envelope = new Uint8Array(await cfgRes.arrayBuffer());
          const { bytes } = await openItem(envelope);
          const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
          if (!isFinConfig(parsed)) throw new Error("bad shape");
          config = parsed;
          existed = true;
        } catch {
          if (!cancelled) setDataErr("tamper");
          return;
        }
      } else {
        if (!cancelled) setDataErr("unreachable");
        return;
      }

      // snapkey — 404 offers the enable flow, 503/network hides the trend.
      let sk: Snapkey | null = null;
      let skAbsent = false;
      let unavailable = false;
      if (skR.status === "rejected") {
        unavailable = true;
      } else if (skR.value.status === 404) {
        skAbsent = true;
      } else if (skR.value.status === 200) {
        try {
          const parsed: unknown = await skR.value.json();
          if (isSnapkey(parsed)) sk = parsed;
        } catch {
          unavailable = true;
        }
      } else {
        unavailable = true;
      }

      // snapshots — ciphertext boxes; 503/network hides the trend.
      let rawDays: { date: string; box_b64: string }[] = [];
      if (snapR.status === "rejected") {
        unavailable = true;
      } else if (snapR.value.status === 200) {
        try {
          const body: unknown = await snapR.value.json();
          const days = (body as { days?: unknown })?.days;
          if (Array.isArray(days)) rawDays = days;
        } catch {
          unavailable = true;
        }
      } else {
        unavailable = true;
      }

      // Open the sealed private half once, then each day's box. A per-day failure
      // is skipped; a failure to open the PRIV itself means a stale cached key —
      // the whole panel can't decrypt.
      const boxes: SnapBoxPayload[] = [];
      if (sk) {
        let priv: CryptoKey;
        try {
          const { bytes } = await openItem(fromB64url(sk.sealed_priv_b64));
          priv = await importBoxPriv(bytes);
        } catch {
          if (!cancelled) setDataErr("tamper");
          return;
        }
        const pub = fromB64url(sk.pub_b64);
        for (const day of rawDays) {
          try {
            const plain = await boxOpen(priv, pub, fromB64url(day.box_b64));
            const parsed: unknown = JSON.parse(new TextDecoder().decode(plain));
            if (isSnapBoxPayload(parsed)) boxes.push(parsed);
            else console.error("[fin] snapshot bad shape", day.date);
          } catch (err) {
            console.error("[fin] snapshot decrypt failed", day.date, err);
          }
        }
      }

      if (cancelled) return;
      setCfg(config);
      setConfigExisted(existed);
      setSnapkeyAbsent(skAbsent);
      setPayloads(boxes);
      setTrendNote(unavailable ? "history unavailable" : null);
    })();

    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem]);

  // Seal `next` and PUT it — overwrite iff a remote config already existed.
  async function putConfig(
    next: FinConfig,
    existed: boolean,
  ): Promise<"ok" | "conflict" | "failed"> {
    const bytes = new TextEncoder().encode(JSON.stringify(next));
    const sealed = await vault.sealItem(
      { n: "fin.json", t: "application/json", s: bytes.length },
      bytes,
    );
    const res = await fetch("/api/fin/config", {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        ...(existed ? { "x-fin-overwrite": "1" } : {}),
      },
      body: new Blob([sealed as BlobPart]),
    });
    if (res.status === 409) return "conflict";
    return res.ok ? "ok" : "failed";
  }

  async function fetchConfigFresh(): Promise<FinConfig> {
    const res = await fetch("/api/fin/config");
    if (res.status === 404) return { v: 1, entries: [] };
    if (res.status !== 200) throw new Error("config refetch failed");
    const envelope = new Uint8Array(await res.arrayBuffer());
    const { bytes } = await openItem(envelope);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isFinConfig(parsed)) throw new Error("config refetch: bad shape");
    return parsed;
  }

  // Upsert today's cash row, retrying once against a fresh config on a 409.
  async function saveEntry(fields: {
    cash: number;
    hisa: number;
    rate: number | null;
  }): Promise<boolean> {
    if (!cfg) return false;
    try {
      const entry: FinEntry = { date: sydneyToday(), ...fields };
      let base = cfg;
      let result = await putConfig(upsertEntry(base, entry), configExisted);
      if (result === "conflict") {
        base = await fetchConfigFresh();
        result = await putConfig(upsertEntry(base, entry), true);
      }
      if (result !== "ok") return false;
      setCfg(upsertEntry(base, entry));
      setConfigExisted(true);
      setEditing(false);
      return true;
    } catch {
      return false;
    }
  }

  // Mint the static box keypair, seal its private half under the MK, publish the
  // public point. A 409 means one already exists — adopt it instead.
  async function enableSnapshots() {
    if (enabling) return;
    setEnabling(true);
    setEnableErr(false);
    try {
      const { pubRaw, privPkcs8 } = await generateBoxKeypair();
      const sealed = await vault.sealItem(
        { n: "snapkey", t: "application/octet-stream", s: privPkcs8.length },
        privPkcs8,
      );
      const sk: Snapkey = {
        v: 1,
        alg: "ECDH-P256",
        pub_b64: toB64url(pubRaw),
        sealed_priv_b64: toB64url(sealed),
      };
      const res = await fetch("/api/fin/snapkey", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sk),
      });
      if (res.status === 409) {
        // A key already exists (a race, or another device). Adopt it: confirm a
        // valid one is really there before clearing the absent flag.
        const existing = await fetch("/api/fin/snapkey");
        if (existing.status === 200 && isSnapkey(await existing.json()))
          setSnapkeyAbsent(false);
        return;
      }
      if (!res.ok) throw new Error("snapkey put failed");
      setSnapkeyAbsent(false);
      setJustEnabled(true);
    } catch {
      setEnableErr(true);
    } finally {
      setEnabling(false);
    }
  }

  // --- non-unlocked states: invested-only header, no sealed data revealed ---
  if (!unlocked) {
    return (
      <>
        <NetWorthHeader
          figure={aud(invested)}
          sub={
            vault.status === "offline"
              ? "store offline — set BLOB_READ_WRITE_TOKEN"
              : undefined
          }
        >
          {vault.status === "locked" && <PlaceholderRows />}
        </NetWorthHeader>
        {holdings}
        {vault.status === "setup" && (
          <div className="border-t border-hairline px-4 py-4 text-xs text-muted">
            set a vault passphrase in{" "}
            <Link href="/files" className="text-amber hover:underline">
              files/
            </Link>{" "}
            first
          </div>
        )}
        {vault.status === "locked" && <UnlockBox vault={vault} />}
        {vault.status === "error" && (
          <div className="border-t border-hairline px-4 py-4 text-xs text-down">
            {UNREACHABLE}
          </div>
        )}
      </>
    );
  }

  // --- unlocked: a data error or the still-loading gap ---
  if (dataErr) {
    return (
      <>
        <NetWorthHeader figure={aud(invested)} />
        {holdings}
        <div className="border-t border-hairline px-4 py-4 text-xs text-down">
          {dataErr === "unreachable" ? UNREACHABLE : TAMPER}
        </div>
      </>
    );
  }
  if (!cfg) {
    return (
      <>
        <NetWorthHeader figure={aud(invested)} sub="decrypting…" />
        {holdings}
      </>
    );
  }

  // --- unlocked, decrypted ---
  const latest = latestEntry(cfg);
  const cash = latest?.cash ?? 0;
  const hisa = latest?.hisa ?? 0;
  const rate = latest?.rate ?? null;
  const series = buildNetWorthSeries(payloads, cfg);

  return (
    <>
      <NetWorthHeader
        figure={aud(invested + cash + hisa)}
        sub={`invested ${aud(invested)} · cash ${aud(cash)} · hisa ${aud(
          hisa,
        )}${rate != null ? ` @ ${rate}%` : ""}`}
      >
        {snapkeyAbsent ? (
          <div className="mt-3">
            <button
              type="button"
              onClick={enableSnapshots}
              disabled={enabling}
              className={btn}
            >
              {enabling ? "generating key…" : "enable snapshot history"}
            </button>
            {enableErr && (
              <p className="mt-2 text-xs text-down">
                couldn&apos;t enable — try again
              </p>
            )}
          </div>
        ) : trendNote ? (
          <p className="mt-3 text-[11px] text-muted/60">{trendNote}</p>
        ) : series.length >= 2 ? (
          <TrendChart series={series} />
        ) : (
          <p className="mt-3 text-[11px] text-muted/60">
            {justEnabled
              ? "first point lands with tonight's snapshot"
              : "trend builds as daily snapshots accrue"}
          </p>
        )}
      </NetWorthHeader>

      {holdings}

      <div className="border-t border-hairline px-4 py-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted">
            cash
          </p>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-xs text-muted transition-colors hover:text-amber"
            >
              edit
            </button>
          )}
        </div>
        {editing ? (
          <CashEditor
            initial={latest}
            onSave={saveEntry}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="space-y-1.5 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-muted">chequing</span>
              <span className="tabular-nums text-fg/90">{aud(cash)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-muted">
                HISA{rate != null ? ` · ${rate}% p.a.` : ""}
              </span>
              <span className="tabular-nums text-fg/90">{aud(hisa)}</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** The shared net-worth block: a label, the big figure, an optional sub-line, and
 *  whatever trend/placeholder content the state supplies. */
function NetWorthHeader({
  figure,
  sub,
  children,
}: {
  figure: string;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="border-b border-hairline px-4 py-4">
      <p className="mb-1 text-[11px] uppercase tracking-[0.2em] text-muted">
        net worth
      </p>
      <span className="text-2xl tabular-nums text-fg">{figure}</span>
      {sub != null && (
        <span className="ml-3 text-xs tabular-nums text-muted">{sub}</span>
      )}
      {children}
    </div>
  );
}

/** Locked: cash/HISA/total sit behind the key, shown as dotted placeholders. */
function PlaceholderRows() {
  return (
    <div className="mt-3 space-y-1.5 text-sm">
      {["cash", "HISA", "total"].map((label) => (
        <div key={label} className="flex items-baseline justify-between">
          <span className="text-muted">{label}</span>
          <span className="tabular-nums text-muted/40">·····</span>
        </div>
      ))}
    </div>
  );
}

/** The net-worth trend: the sealed daily snapshots, valued (cents → dollars) and
 *  drawn as the same sparkline the env-backed series used to feed. */
function TrendChart({ series }: { series: NetWorthPoint[] }) {
  const values = series.map((p) => p.totalCents / 100);
  const delta = values[values.length - 1] - values[0];
  return (
    <div className="mt-4">
      <div className="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-[0.2em] text-muted">
        <span>trend</span>
        <span className={`tabular-nums ${tone(delta)}`}>
          {arrow(delta)} {delta >= 0 ? "+" : ""}
          {aud(delta)}
        </span>
      </div>
      <Sparkline values={values} delta={delta} />
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted/60">
        <span>{series[0].date.slice(5)}</span>
        <span>{series[series.length - 1].date.slice(5)}</span>
      </div>
    </div>
  );
}

/** Locked: an inline passphrase prompt reusing the one MK (LockedPanel's idiom). */
function UnlockBox({ vault }: { vault: Vault }) {
  const [pass, setPass] = useState("");

  async function submit() {
    if (!pass || vault.working) return;
    await vault.unlock(pass);
    setPass("");
  }

  return (
    <div className="border-t border-hairline px-4 py-4 text-xs">
      <p className="mb-2 text-muted">
        vault <span className="text-amber">locked</span> — enter the passphrase
        to reveal cash + net worth.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={pass}
          disabled={vault.working}
          onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="passphrase"
          className={`flex-1 ${input}`}
        />
        <button
          type="button"
          onClick={submit}
          disabled={vault.working || !pass}
          className={btn}
        >
          {vault.working ? "deriving key…" : "unlock"}
        </button>
      </div>
      {vault.error && <p className="mt-2 text-down">{vault.error}</p>}
    </div>
  );
}

/** The cash/HISA/rate editor — three validated inputs sealing today's entry. */
function CashEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: FinEntry | null;
  onSave: (f: {
    cash: number;
    hisa: number;
    rate: number | null;
  }) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [cashInput, setCashInput] = useState(
    initial ? String(initial.cash) : "",
  );
  const [hisaInput, setHisaInput] = useState(
    initial ? String(initial.hisa) : "",
  );
  const [rateInput, setRateInput] = useState(
    initial?.rate != null ? String(initial.rate) : "",
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(false);

  const cashNum = Number(cashInput);
  const hisaNum = Number(hisaInput);
  const rateTrim = rateInput.trim();
  const rateNum = rateTrim === "" ? null : Number(rateTrim);
  const valid =
    Number.isFinite(cashNum) &&
    cashNum >= 0 &&
    Number.isFinite(hisaNum) &&
    hisaNum >= 0 &&
    (rateNum === null || (Number.isFinite(rateNum) && rateNum >= 0));

  async function submit() {
    if (!valid || saving) return;
    setSaving(true);
    setErr(false);
    if (await onSave({ cash: cashNum, hisa: hisaNum, rate: rateNum })) return;
    setErr(true);
    setSaving(false);
  }

  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
    placeholder: string,
  ) => (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted">{label}</span>
      <input
        value={value}
        disabled={saving}
        inputMode="decimal"
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
        className={`${input} w-32 text-right`}
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-2">
      {field("cash", cashInput, setCashInput, "0")}
      {field("hisa", hisaInput, setHisaInput, "0")}
      {field("rate", rateInput, setRateInput, "—")}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={submit}
          disabled={saving || !valid}
          className={btn}
        >
          {saving ? "sealing…" : "save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className={btn}
        >
          cancel
        </button>
      </div>
      {err && <p className="text-xs text-down">save failed — try again</p>}
    </div>
  );
}
