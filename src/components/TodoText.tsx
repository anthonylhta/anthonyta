"use client";

import { Fragment } from "react";
import { linkParts } from "@/lib/todo";

/**
 * One line of captured text, with any http(s) links in it tappable. A capture
 * saved from /reader is `headline — link`, and a link you can only read is half
 * a capture: the row exists so the thing can be opened later.
 *
 * The click is stopped from bubbling because the row AROUND this text carries
 * the done/pin controls — following a link must never also tick the item off.
 * Nothing is parsed as markup: every part renders as React text, and only an
 * explicit scheme (lib/todo's linkParts) becomes an anchor.
 */
export function TodoText({ text }: { text: string }) {
  return (
    <>
      {linkParts(text).map((part, i) =>
        part.href ? (
          <a
            key={i}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="underline decoration-hairline hover:text-amber"
          >
            {part.text}
          </a>
        ) : (
          <Fragment key={i}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}
