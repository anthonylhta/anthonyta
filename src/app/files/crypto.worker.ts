/**
 * crypto worker — runs file-sized seal/open off the main thread so a 25MB
 * encrypt doesn't freeze the UI (ADR 0053). Stateless by design: every request
 * carries the (non-extractable, structured-cloneable) master key and its bytes,
 * and buffers travel as transferables both ways so nothing large is copied.
 * All the actual cryptography lives in lib/crypto — this file is only a
 * message shell, and callers fall back to calling lib/crypto on the main
 * thread if constructing the worker fails.
 */
import { open, seal, type EnvelopeMeta } from "@/lib/crypto";

export type WorkerRequest =
  | { id: number; op: "seal"; mk: CryptoKey; meta: EnvelopeMeta; buf: ArrayBuffer }
  | { id: number; op: "open"; mk: CryptoKey; buf: ArrayBuffer };

export type WorkerResponse =
  | { id: number; ok: true; meta?: EnvelopeMeta; buf: ArrayBuffer }
  | { id: number; ok: false };

self.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  try {
    if (req.op === "seal") {
      const out = await seal(req.mk, req.meta, new Uint8Array(req.buf));
      const buf = out.buffer as ArrayBuffer;
      self.postMessage({ id: req.id, ok: true, buf } satisfies WorkerResponse, {
        transfer: [buf],
      });
    } else {
      const { meta, bytes } = await open(req.mk, new Uint8Array(req.buf));
      const buf = bytes.buffer as ArrayBuffer;
      self.postMessage(
        { id: req.id, ok: true, meta, buf } satisfies WorkerResponse,
        { transfer: [buf] },
      );
    }
  } catch {
    self.postMessage({ id: req.id, ok: false } satisfies WorkerResponse);
  }
});
