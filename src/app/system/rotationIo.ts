/**
 * rotationIo — the fetch-backed RotationIo adapter (the prfCeremony pattern:
 * the engine + crash matrix live in lib/rotationdriver against a fake store;
 * this thin file is the only untested seam, so it contains routing ONLY, no
 * logic). Every route already exists (ADR 0104): reads via the per-store GET,
 * writes via presigned PUTs for the big prefixes and overwrite-header PUTs for
 * the fixed configs.
 */

import { isKeystore, type Keystore } from "@/lib/crypto";
import type { DropboxKey } from "@/lib/dropbox";
import type { RotationIo } from "@/lib/rotationdriver";

/** Fixed config stores: GET route + the overwrite header its PUT requires. */
const CONFIG_ROUTES: Record<string, { route: string; header: string }> = {
  "meta/fin": { route: "/api/fin/config", header: "x-fin-overwrite" },
  "meta/transit": {
    route: "/api/transit/config",
    header: "x-transit-overwrite",
  },
  "meta/todo": { route: "/api/todo", header: "x-todo-overwrite" },
  "meta/totp": { route: "/api/totp", header: "x-totp-overwrite" },
};

function rawRoute(key: string): string | null {
  if (key.startsWith("vault/"))
    return `/api/vault/raw?p=${encodeURIComponent(key)}`;
  if (key.startsWith("inbox/"))
    return `/api/files/raw?p=${encodeURIComponent(key)}`;
  return CONFIG_ROUTES[key]?.route ?? null;
}

async function presignedWrite(
  mint: string,
  key: string,
  bytes: Uint8Array,
): Promise<boolean> {
  const res = await fetch(mint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pathname: key, size: bytes.byteLength }),
  });
  if (!res.ok) return false;
  const { url } = (await res.json()) as { url?: string };
  if (typeof url !== "string") return false;
  const put = await fetch(url, {
    method: "PUT",
    body: bytes as unknown as BodyInit,
  });
  return put.ok;
}

export const rotationIo: RotationIo = {
  async getKeystore(): Promise<Keystore | null> {
    const res = await fetch("/api/files/keystore");
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`keystore fetch: ${res.status}`);
    const parsed: unknown = await res.json();
    if (!isKeystore(parsed)) throw new Error("keystore fetch: malformed");
    return parsed;
  },

  async putKeystore(ks: Keystore): Promise<boolean> {
    const res = await fetch("/api/files/keystore", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-keystore-overwrite": "1",
      },
      body: JSON.stringify(ks),
    });
    return res.ok;
  },

  async getJournal(): Promise<Uint8Array | "absent" | "error"> {
    try {
      const res = await fetch("/api/rotation");
      if (res.status === 404) return "absent";
      if (!res.ok) return "error";
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      return "error";
    }
  },

  async putJournal(
    bytes: Uint8Array,
    overwrite: boolean,
  ): Promise<"ok" | "conflict" | "failed"> {
    try {
      const res = await fetch("/api/rotation", {
        method: "PUT",
        headers: {
          "content-type": "application/octet-stream",
          ...(overwrite ? { "x-rotation-overwrite": "1" } : {}),
        },
        body: bytes as unknown as BodyInit,
      });
      if (res.status === 409) return "conflict";
      return res.ok ? "ok" : "failed";
    } catch {
      return "failed";
    }
  },

  async deleteJournal(): Promise<boolean> {
    const res = await fetch("/api/rotation", { method: "DELETE" });
    return res.ok;
  },

  async listEstate(): Promise<string[] | null> {
    try {
      const res = await fetch("/api/rotation/listing");
      if (!res.ok) return null;
      const { entries } = (await res.json()) as {
        entries?: { key?: unknown }[];
      };
      if (!Array.isArray(entries)) return null;
      const keys: string[] = [];
      for (const e of entries) {
        if (typeof e?.key !== "string") return null; // partial > none: refuse
        keys.push(e.key);
      }
      return keys;
    } catch {
      return null;
    }
  },

  async readBlob(key: string): Promise<Uint8Array | null> {
    const route = rawRoute(key);
    if (route === null) return null;
    const res = await fetch(route);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  },

  async writeBlob(key: string, bytes: Uint8Array): Promise<boolean> {
    if (key.startsWith("vault/"))
      return presignedWrite("/api/vault/upload", key, bytes);
    if (key.startsWith("inbox/"))
      return presignedWrite("/api/files/upload", key, bytes);
    const cfg = CONFIG_ROUTES[key];
    if (cfg === undefined) return false;
    const res = await fetch(cfg.route, {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        [cfg.header]: "1",
      },
      body: bytes as unknown as BodyInit,
    });
    return res.ok;
  },

  async getDropboxKey(): Promise<DropboxKey | null> {
    const res = await fetch("/api/dropbox/key");
    if (!res.ok) return null;
    return (await res.json()) as DropboxKey;
  },

  async putDropboxKey(rec: DropboxKey): Promise<boolean> {
    const res = await fetch("/api/dropbox/key", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-dropboxkey-overwrite": "1",
      },
      body: JSON.stringify(rec),
    });
    return res.ok;
  },

  async dropPrfWraps(): Promise<boolean> {
    const res = await fetch("/api/prf/wrap", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ v: 1, wraps: [] }),
    });
    return res.ok;
  },
};
