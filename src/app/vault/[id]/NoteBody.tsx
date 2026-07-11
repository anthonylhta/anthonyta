"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Vault } from "@/app/files/useVault";
import { imageBlob, parseVaultImgId } from "@/lib/vaultblob";

/**
 * Renders a note's (already-preprocessed) markdown. Frontmatter is stripped and
 * `[[wikilinks]]` are resolved to `/vault/<id>` links upstream, so this just
 * styles standard markdown with the Warm Terminal palette via child selectors
 * (same approach as the /notes prose body). The one wrinkle vs plain markdown:
 * `![[embeds]]` become `/vault/img/<id>` sources, which are themselves encrypted
 * blobs — so the `img` renderer fetches + decrypts each to an object URL.
 */
export function NoteBody({
  md,
  openItem,
}: {
  md: string;
  openItem: Vault["openItem"];
}) {
  return (
    <div className="px-4 py-5 font-[family-name:var(--font-geist-sans)] text-[15px] leading-relaxed text-fg/85 [&_a:hover]:underline [&_a]:text-amber [&_blockquote]:mb-3.5 [&_blockquote]:border-l-2 [&_blockquote]:border-hairline [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_code]:rounded [&_code]:bg-surface [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-[family-name:var(--font-geist-mono)] [&_code]:text-[13px] [&_code]:text-amber [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-lg [&_h1]:text-fg [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-base [&_h2]:text-fg [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-sm [&_h3]:uppercase [&_h3]:tracking-wide [&_h3]:text-muted [&_hr]:my-5 [&_hr]:border-hairline [&_img]:my-3 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded [&_img]:border [&_img]:border-hairline [&_li]:mb-1 [&_ol]:mb-3.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3.5 [&_pre]:mb-3.5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-hairline [&_pre]:bg-surface/60 [&_pre]:p-3 [&_strong]:font-semibold [&_strong]:text-fg [&_ul]:mb-3.5 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ src, alt }) => (
            <VaultImg
              src={typeof src === "string" ? src : undefined}
              alt={typeof alt === "string" ? alt : undefined}
              openItem={openItem}
            />
          ),
        }}
      >
        {md}
      </ReactMarkdown>
    </div>
  );
}

/**
 * A single markdown image. External/http/data sources render as a plain `<img>`;
 * a `/vault/img/<id>` embed is an encrypted blob, so it's fetched, decrypted to an
 * object URL, and revoked on unmount (the whole body unmounts on lock, taking every
 * embed's URL with it). Object-URL images work because this feature's CSP change
 * allows `blob:` in `img-src`.
 */
function VaultImg({
  src,
  alt,
  openItem,
}: {
  src?: string;
  alt?: string;
  openItem: Vault["openItem"];
}) {
  const id = src ? parseVaultImgId(src) : null;
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(
          `/api/vault/raw?p=${encodeURIComponent(imageBlob(id))}`,
        );
        if (!res.ok) throw new Error("fetch failed");
        const { meta, bytes } = await openItem(
          new Uint8Array(await res.arrayBuffer()),
        );
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(
          new Blob([bytes as BlobPart], { type: meta.t || "image/*" }),
        );
        urlRef.current = objectUrl;
        setUrl(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [id, openItem]);

  // External / already-plain source — nothing to decrypt.
  if (!id) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt ?? ""} loading="lazy" />;
  }

  if (!url) {
    return (
      <span
        className={`my-3 inline-flex items-center justify-center border border-hairline px-3 py-2 font-mono text-[10px] ${
          failed ? "text-down/70" : "text-muted/50"
        }`}
      >
        [image]
      </span>
    );
  }

  return (
    // A decrypted-in-browser object URL — next/image can't optimize a blob:, and
    // the bytes never touch the network again (same as the inbox thumbnails).
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt ?? ""}
      className="max-w-full border border-hairline"
    />
  );
}
