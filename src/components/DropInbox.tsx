"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  boxOpen,
  fromB64url,
  generateBoxKeypair,
  importBoxPriv,
  toB64url,
} from "@/lib/crypto";
import { isDropboxKey, isDropMessage } from "@/lib/dropbox";
import { useVault, type Vault } from "@/app/files/useVault";

// Shared input/button idioms, lifted from the finance panel.
const input =
  "border border-hairline bg-transparent px-2 py-1 font-mono text-[13px] text-fg placeholder:text-muted focus:border-amber focus:outline-none disabled:opacity-50";
const btn =
  "border border-hairline px-2 py-1 text-muted transition-colors hover:border-amber hover:text-amber disabled:opacity-30";

const UNREACHABLE =
  "vault unreachable — reload to retry (your key is untouched)";

/** One opened message, plus the stored path so a read can delete it. */
interface Opened {
  path: string;
  body: string;
  contact?: string;
  at: string;
}

type KeyStatus = "loading" | "absent" | "ready" | "error";

/**
 * The owner's encrypted drop-box inbox (ADR: sealed box, resurrected) — a client
 * island behind the SAME vault unlock the finance panel uses (ADR 0061). Nothing
 * renders before the key: the box's private half is sealed under the master key, and
 * every message opens IN THE BROWSER only while the vault is unlocked. The server only
 * ever held ciphertext. The box is minted once (generate keypair → seal the private
 * half → publish the public point); after that the panel lists, opens, and deletes.
 */
export function DropInbox({ offline }: { offline: boolean }) {
  const vault = useVault(offline);
  const { openItem, sealItem } = vault;
  const unlocked = vault.status === "unlocked";

  const [keyStatus, setKeyStatus] = useState<KeyStatus>("loading");
  const [messages, setMessages] = useState<Opened[]>([]);
  const [busy, setBusy] = useState(false);
  // The recovered private key never outlives the unlock effect: it's unsealed, used
  // to open the whole listing right there, and dropped. Nothing retains it across a
  // render, so there's no key material to wipe on lock beyond the master key itself.

  // Reset per-unlock state on the lock/unlock edge (the lint-blessed reset pattern).
  const [prevUnlocked, setPrevUnlocked] = useState(unlocked);
  if (prevUnlocked !== unlocked) {
    setPrevUnlocked(unlocked);
    setKeyStatus("loading");
    setMessages([]);
  }

  // Recover the box key and open every message, once per unlock.
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/dropbox/key");
        if (res.status === 404) {
          if (!cancelled) setKeyStatus("absent");
          return;
        }
        if (!res.ok) throw new Error("key fetch failed");
        const rec: unknown = await res.json();
        if (!isDropboxKey(rec)) throw new Error("bad key record");

        // Unseal the private half under the master key, import it non-extractable.
        const { bytes } = await openItem(fromB64url(rec.sealed_priv_b64));
        const priv = await importBoxPriv(bytes);
        const pubRaw = fromB64url(rec.pub_b64);
        if (cancelled) return;

        const opened = await loadMessages(priv, pubRaw);
        if (cancelled) return;
        setMessages(opened);
        setKeyStatus("ready");
      } catch {
        if (!cancelled) setKeyStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [unlocked, openItem]);

  // Mint the box on first use: fresh keypair, seal the private half under the MK,
  // publish the public point. No-clobber PUT — a second setup refuses (409).
  async function enable() {
    if (busy) return;
    setBusy(true);
    try {
      const { pubRaw, privPkcs8 } = await generateBoxKeypair();
      const sealed = await sealItem(
        { n: "dropboxkey", t: "application/octet-stream", s: privPkcs8.length },
        privPkcs8,
      );
      const res = await fetch("/api/dropbox/key", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          v: 1,
          alg: "ECDH-P256",
          pub_b64: toB64url(pubRaw),
          sealed_priv_b64: toB64url(sealed),
        }),
      });
      if (!res.ok) throw new Error("enable failed");
      // Freshly minted, so there's nothing to open yet — an empty ready inbox.
      setMessages([]);
      setKeyStatus("ready");
    } catch {
      setKeyStatus("error");
    } finally {
      setBusy(false);
    }
  }

  // Delete-on-read: drop the ciphertext server-side, then remove the row.
  async function dismiss(path: string) {
    try {
      await fetch("/api/dropbox/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path }),
      });
    } catch {
      // A failed delete just leaves the row; the next lock/unlock re-lists.
    }
    setMessages((prev) => prev.filter((m) => m.path !== path));
  }

  // --- pre-unlock: nothing sensitive renders before the key ---
  if (!unlocked) {
    if (vault.status === "offline") return null; // store off — feature simply absent
    return (
      <Shell>
        {vault.status === "setup" && (
          <p className="text-muted">
            set a vault passphrase in{" "}
            <Link href="/files" className="text-amber hover:underline">
              files/
            </Link>{" "}
            first
          </p>
        )}
        {vault.status === "locked" && <UnlockBox vault={vault} />}
        {vault.status === "error" && <p className="text-down">{UNREACHABLE}</p>}
        {vault.status === "loading" && <p className="text-muted">…</p>}
      </Shell>
    );
  }

  // --- unlocked ---
  if (keyStatus === "loading")
    return (
      <Shell>
        <p className="text-muted">decrypting…</p>
      </Shell>
    );
  if (keyStatus === "error")
    return (
      <Shell>
        <p className="text-down">{UNREACHABLE}</p>
      </Shell>
    );
  if (keyStatus === "absent")
    return (
      <Shell>
        <p className="mb-2 text-muted">
          the drop box isn&apos;t enabled yet — mint a keypair to start
          receiving sealed messages on{" "}
          <Link href="/contact" className="text-amber hover:underline">
            contact/
          </Link>
          .
        </p>
        <button type="button" onClick={enable} disabled={busy} className={btn}>
          {busy ? "minting…" : "enable drop box"}
        </button>
      </Shell>
    );

  return (
    <Shell count={messages.length}>
      {messages.length === 0 ? (
        <p className="text-muted">no messages</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {messages.map((m) => (
            <li key={m.path} className="border border-hairline px-3 py-2">
              <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
                <span className="tabular-nums">{stamp(m.at)}</span>
                <button
                  type="button"
                  onClick={() => dismiss(m.path)}
                  className="transition-colors hover:text-amber"
                >
                  delete
                </button>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm text-fg/90">
                {m.body}
              </p>
              {m.contact && (
                <p className="mt-1.5 text-xs text-amber/90">↩ {m.contact}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

/**
 * Fetch the listing and open every envelope with the recovered key. A row that
 * won't open (tamper, garbage, wrong shape) is skipped, not fatal — one bad message
 * can't hide the rest.
 */
async function loadMessages(
  priv: CryptoKey,
  pubRaw: Uint8Array,
): Promise<Opened[]> {
  const res = await fetch("/api/dropbox/list");
  if (!res.ok) throw new Error("list failed");
  const { drops } = (await res.json()) as {
    drops: { key: string; envelope_b64: string }[];
  };
  const opened: Opened[] = [];
  for (const d of drops) {
    try {
      const plain = await boxOpen(priv, pubRaw, fromB64url(d.envelope_b64));
      const parsed: unknown = JSON.parse(new TextDecoder().decode(plain));
      if (!isDropMessage(parsed)) continue;
      opened.push({
        path: d.key,
        body: parsed.body,
        contact: parsed.contact,
        at: parsed.at,
      });
    } catch {
      // skip an unopenable row
    }
  }
  // Newest first by the sender's advisory stamp.
  opened.sort((a, b) => (a.at < b.at ? 1 : -1));
  return opened;
}

/** A locale-free short stamp for the sender's advisory ISO time (Sydney clock). */
function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-AU", {
    timeZone: "Australia/Sydney",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** The panel chrome — a labelled block matching the command center's rows. */
function Shell({
  children,
  count,
}: {
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <div className="border-b border-hairline px-4 py-3 text-xs">
      <p className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-muted">
        drop box
        {count != null && count > 0 && (
          <span className="text-amber">· {count}</span>
        )}
      </p>
      {children}
    </div>
  );
}

/** Inline passphrase prompt reusing the one master key (FinPanel's idiom). */
function UnlockBox({ vault }: { vault: Vault }) {
  const [pass, setPass] = useState("");

  async function submit() {
    if (!pass || vault.working) return;
    await vault.unlock(pass);
    setPass("");
  }

  return (
    <div>
      <p className="mb-2 text-muted">
        vault <span className="text-amber">locked</span> — unlock to read sealed
        messages.
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
