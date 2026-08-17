"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * PdfPages — the inbox viewer's PDF renderer for devices with no inline viewer
 * of their own (Android Chrome; ADR 0125 left this as the named slice). pdf.js,
 * self-hosted: the library is code-split behind a dynamic import so /files pays
 * for it only when a PDF is opened here, and every runtime asset it fetches —
 * the module worker, the wasm image decoders scanned PDFs need, standard fonts,
 * CMaps — is served same-origin from public/pdfjs (copied from the installed
 * package on postinstall), inside the existing worker-src 'self' /
 * connect-src 'self' / wasm-unsafe-eval policy. Nothing leaves the device: the
 * decrypted bytes go straight to the worker, and the document is destroyed with
 * the item (lock, unmount).
 *
 * Pages render to canvases at device resolution, a batch at a time — a long
 * scan is not decoded end to end on open.
 */

const ASSETS = "/pdfjs/";
const FIRST_BATCH = 6;
const BATCH = 6;

export function PdfPages({ bytes, name }: { bytes: Uint8Array; name: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(FIRST_BATCH);

  useEffect(() => {
    let cancelled = false;
    // The loading task owns the worker + document; destroying it tears both
    // down (the effect's cleanup, on lock/unmount/re-decrypt).
    let task: { destroy: () => Promise<void> } | null = null;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = `${ASSETS}pdf.worker.min.mjs`;
        const loading = pdfjs.getDocument({
          // pdf.js transfers (detaches) the buffer it is handed — give it a copy,
          // the item's own bytes stay whole for the save link.
          data: new Uint8Array(bytes),
          wasmUrl: `${ASSETS}wasm/`,
          standardFontDataUrl: `${ASSETS}standard_fonts/`,
          cMapUrl: `${ASSETS}cmaps/`,
          cMapPacked: true,
        });
        task = loading;
        const loaded = await loading.promise;
        if (cancelled) return;
        setDoc(loaded);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [bytes]);

  if (failed)
    return (
      <p className="mt-2 text-xs text-muted">
        couldn&apos;t render this pdf here — save to view
      </p>
    );
  if (!doc) return <p className="mt-2 text-xs text-muted">rendering pdf…</p>;

  const total = doc.numPages;
  const upto = Math.min(shown, total);
  return (
    <div className="mt-2 flex flex-col gap-2" aria-label={name}>
      {Array.from({ length: upto }, (_, i) => (
        <Page key={i + 1} doc={doc} n={i + 1} />
      ))}
      <p className="flex items-baseline gap-3 text-[11px] text-muted">
        <span className="tabular-nums">
          {upto} of {total} page{total === 1 ? "" : "s"}
        </span>
        {upto < total && (
          <button
            type="button"
            onClick={() => setShown((s) => s + BATCH)}
            className="transition-colors hover:text-amber"
          >
            + {Math.min(BATCH, total - upto)} more
          </button>
        )}
      </p>
    </div>
  );
}

/** One page onto one canvas, fitted to the container's width at up to 2× device
 *  pixels. A render in flight is cancelled with the effect, so a page never
 *  paints onto a canvas that has moved on. */
function Page({ doc, n }: { doc: PDFDocumentProxy; n: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    (async () => {
      const page = await doc.getPage(n);
      const c = canvas.current;
      if (cancelled || !c) return;
      const width = c.parentElement?.clientWidth || 320;
      const scale = width / page.getViewport({ scale: 1 }).width;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: scale * dpr });
      c.width = Math.floor(viewport.width);
      c.height = Math.floor(viewport.height);
      c.style.width = `${width}px`;
      c.style.height = `${Math.floor(viewport.height / dpr)}px`;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const render = page.render({ canvas: c, canvasContext: ctx, viewport });
      task = render;
      await render.promise;
    })().catch(() => {
      // A cancelled render rejects by design; a genuinely broken page leaves
      // its canvas blank rather than taking the document down with it.
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, n]);

  return (
    <canvas
      ref={canvas}
      className="block w-full border border-hairline"
      aria-label={`page ${n}`}
    />
  );
}
