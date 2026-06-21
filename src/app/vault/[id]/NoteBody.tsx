"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders a note's (already-preprocessed) markdown. Frontmatter is stripped and
 * `[[wikilinks]]` are resolved to `/vault/<id>` links upstream, so this just
 * styles standard markdown with the Warm Terminal palette via child selectors
 * (same approach as the /notes prose body).
 */
export function NoteBody({ md }: { md: string }) {
  return (
    <div className="px-4 py-5 font-[family-name:var(--font-geist-sans)] text-[15px] leading-relaxed text-fg/85 [&_a:hover]:underline [&_a]:text-amber [&_blockquote]:mb-3.5 [&_blockquote]:border-l-2 [&_blockquote]:border-hairline [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_code]:rounded [&_code]:bg-surface [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-[family-name:var(--font-geist-mono)] [&_code]:text-[13px] [&_code]:text-amber [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-lg [&_h1]:text-fg [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-base [&_h2]:text-fg [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-sm [&_h3]:uppercase [&_h3]:tracking-wide [&_h3]:text-muted [&_hr]:my-5 [&_hr]:border-hairline [&_li]:mb-1 [&_ol]:mb-3.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3.5 [&_pre]:mb-3.5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-hairline [&_pre]:bg-surface/60 [&_pre]:p-3 [&_strong]:font-semibold [&_strong]:text-fg [&_ul]:mb-3.5 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
    </div>
  );
}
