"use client";

import Link from "next/link";
import { useRef, useState, useEffect, type ReactNode } from "react";
import { PortfolioCard } from "@/components/terminal/PortfolioCard";
import { Sparkline } from "@/components/terminal/Sparkline";
import {
  buildStepSeries,
  importPortfolioCsv,
  investedAt,
  latestEntry,
  normalizeFinConfig,
  sydneyToday,
  upsertEntry,
  type FinConfig,
  type FinEntry,
  type NetWorthPoint,
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

/** The "as of" stamp for a CSV imported right now — Sydney clock, the same shape
 *  the Drive modifiedTime used to produce, so the card reads identically. */
function importStamp(now: Date = new Date()): string {
  return now.toLocaleString("en-AU", {
    timeZone: "Australia/Sydney",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * The E2EE finance panel: net worth + holdings + cash, all sealed inside ONE fin
 * envelope behind the same master key the files vault owns (ADR 0061). The server
 * never sees a plaintext figure — the CSV is parsed HERE, in the browser, and the
 * envelope decrypts here, only while the vault is unlocked. Until then the panel
 * shows placeholders: nothing financial renders before the key does.
 */
export function FinPanel({ offline }: { offline: boolean }) {
  const vault = useVault(offline);
  const { openItem } = vault;
  const unlocked = vault.status === "unlocked";

  // Decrypted data (unlocked only).
  const [cfg, setCfg] = useState<FinConfig | null>(null);
  const [configExisted, setConfigExisted] = useState(false);
  const [dataErr, setDataErr] = useState<"unreachable" | "tamper" | null>(null);
  const [editing, setEditing] = useState(false);

  // Render-phase adjustment (not an effect): reset the per-unlock state on the
  // lock/unlock edge, per the lint-blessed reset pattern.
  const [prevUnlocked, setPrevUnlocked] = useState(unlocked);
  if (prevUnlocked !== unlocked) {
    setPrevUnlocked(unlocked);
    setDataErr(null);
    setCfg(null);
    setEditing(false);
  }

  // Load + decrypt once per unlock. A cancelled flag drops a late resolve after
  // lock/unmount. `openItem` is a stable callback, so [unlocked, openItem] fires
  // exactly on the lock→unlock edge, never on the working-flag flicker.
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;

    (async () => {
      // A flake must never read as an empty (re-seedable) editor, so 503/network
      // → the unreachable banner; only a healthy 404 → fresh config.
      let config: FinConfig | null = null;
      let existed = false;
      try {
        const res = await fetch("/api/fin/config");
        if (res.status === 404) {
          config = { v: 2, entries: [], invested: [], portfolio: null };
        } else if (res.status === 200) {
          try {
            const envelope = new Uint8Array(await res.arrayBuffer());
            const { bytes } = await openItem(envelope);
            const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
            config = normalizeFinConfig(parsed);
            if (!config) throw new Error("bad shape");
            existed = true;
          } catch {
            if (!cancelled) setDataErr("tamper");
            return;
          }
        } else {
          if (!cancelled) setDataErr("unreachable");
          return;
        }
      } catch {
        if (!cancelled) setDataErr("unreachable");
        return;
      }

      if (cancelled) return;
      setCfg(config);
      setConfigExisted(existed);
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
    if (res.status === 404)
      return { v: 2, entries: [], invested: [], portfolio: null };
    if (res.status !== 200) throw new Error("config refetch failed");
    const envelope = new Uint8Array(await res.arrayBuffer());
    const { bytes } = await openItem(envelope);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const config = normalizeFinConfig(parsed);
    if (!config) throw new Error("config refetch: bad shape");
    return config;
  }

  // Apply a pure config transform, seal, PUT — retrying once against a freshly
  // fetched config on a 409 (another device may have written meanwhile).
  async function saveConfig(
    apply: (base: FinConfig) => FinConfig,
  ): Promise<boolean> {
    if (!cfg) return false;
    try {
      let base = cfg;
      let result = await putConfig(apply(base), configExisted);
      if (result === "conflict") {
        base = await fetchConfigFresh();
        result = await putConfig(apply(base), true);
      }
      if (result !== "ok") return false;
      setCfg(apply(base));
      setConfigExisted(true);
      return true;
    } catch {
      return false;
    }
  }

  // Upsert today's cash row.
  async function saveEntry(fields: {
    cash: number;
    hisa: number;
    rate: number | null;
  }): Promise<boolean> {
    const entry: FinEntry = { date: sydneyToday(), ...fields };
    const ok = await saveConfig((base) => upsertEntry(base, entry));
    if (ok) setEditing(false);
    return ok;
  }

  // Parse a dropped CSV in-browser and seal the result. Parsing happens ONCE, up
  // front — a malformed export errors here and nothing is written.
  async function importCsv(text: string): Promise<"ok" | "bad-csv" | "failed"> {
    if (!cfg) return "failed";
    const opts = { today: sydneyToday(), asOf: importStamp() };
    if (!importPortfolioCsv(cfg, text, opts)) return "bad-csv";
    const ok = await saveConfig(
      (base) => importPortfolioCsv(base, text, opts) as FinConfig,
    );
    return ok ? "ok" : "failed";
  }

  // --- non-unlocked states: placeholders only — nothing financial renders
  // before the key does ---
  if (!unlocked) {
    return (
      <>
        <NetWorthHeader
          figure={null}
          sub={
            vault.status === "offline"
              ? "store offline — set the R2_* env vars"
              : undefined
          }
        >
          {vault.status === "locked" && <PlaceholderRows />}
        </NetWorthHeader>
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
        <NetWorthHeader figure={null} />
        <div className="border-t border-hairline px-4 py-4 text-xs text-down">
          {dataErr === "unreachable" ? UNREACHABLE : TAMPER}
        </div>
      </>
    );
  }
  if (!cfg) {
    return <NetWorthHeader figure={null} sub="decrypting…" />;
  }

  // --- unlocked, decrypted ---
  const today = sydneyToday();
  const invested = investedAt(cfg, today) / 100;
  const latest = latestEntry(cfg);
  const cash = latest?.cash ?? 0;
  const hisa = latest?.hisa ?? 0;
  const rate = latest?.rate ?? null;
  const series = buildStepSeries(cfg, 30, today);

  return (
    <>
      <NetWorthHeader
        figure={aud(invested + cash + hisa)}
        sub={`invested ${aud(invested)} · cash ${aud(cash)} · hisa ${aud(
          hisa,
        )}${rate != null ? ` @ ${rate}%` : ""}`}
      >
        {series.length >= 2 ? (
          <TrendChart series={series} />
        ) : (
          <p className="mt-3 text-[11px] text-muted/60">
            trend builds as imports and cash edits accrue
          </p>
        )}
      </NetWorthHeader>

      <HoldingsSection cfg={cfg} onImport={importCsv} />

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

/** Holdings from the decrypted snapshot, plus the in-browser CSV importer. */
function HoldingsSection({
  cfg,
  onImport,
}: {
  cfg: FinConfig;
  onImport: (text: string) => Promise<"ok" | "bad-csv" | "failed">;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const result = await onImport(await file.text());
      if (result === "bad-csv")
        setErr("not a recognizable CMC ProfitLoss export");
      else if (result === "failed") setErr("import failed — try again");
    } catch {
      setErr("import failed — try again");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <>
      {cfg.portfolio ? (
        <PortfolioCard p={cfg.portfolio} />
      ) : (
        <div className="border-b border-hairline px-4 py-4">
          <p className="mb-1 text-[11px] uppercase tracking-[0.2em] text-muted">
            portfolio
          </p>
          <p className="text-xs text-muted">
            no holdings yet — import a CMC ProfitLoss export below
          </p>
        </div>
      )}
      <div className="flex items-center gap-3 border-b border-hairline px-4 py-3 text-xs">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className={btn}
        >
          {busy ? "parsing + sealing…" : "import csv"}
        </button>
        <span className="text-muted/60">
          parsed in your browser — the export never leaves this device
        </span>
      </div>
      {err && (
        <p className="border-b border-hairline px-4 py-2 text-xs text-down">
          {err}
        </p>
      )}
    </>
  );
}

/** The shared net-worth block: a label, the big figure (dots until decrypted), an
 *  optional sub-line, and whatever trend/placeholder content the state supplies. */
function NetWorthHeader({
  figure,
  sub,
  children,
}: {
  figure: string | null;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="border-b border-hairline px-4 py-4">
      <p className="mb-1 text-[11px] uppercase tracking-[0.2em] text-muted">
        net worth
      </p>
      <span
        className={`text-2xl tabular-nums ${figure === null ? "text-muted/40" : "text-fg"}`}
      >
        {figure ?? "·····"}
      </span>
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
      {["invested", "cash", "HISA"].map((label) => (
        <div key={label} className="flex items-baseline justify-between">
          <span className="text-muted">{label}</span>
          <span className="tabular-nums text-muted/40">·····</span>
        </div>
      ))}
    </div>
  );
}

/** The net-worth trend: the step-function series (invested + cash, ADR 0061),
 *  valued (cents → dollars) and drawn as the same sparkline as always. */
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
        to reveal the portfolio, cash + net worth.
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
