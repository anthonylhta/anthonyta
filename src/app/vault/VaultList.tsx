"use client";

import Link from "next/link";
import { useState } from "react";
import type { VaultNote } from "@/lib/connectors/vault";

/** Client-side filter over the note index (titles + paths). */
export function VaultList({ notes }: { notes: VaultNote[] }) {
  const [q, setQ] = useState("");
  const f = q.trim().toLowerCase();
  const shown = f
    ? notes.filter((n) => n.path.toLowerCase().includes(f))
    : notes;

  return (
    <div className="px-4 py-5">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="search notes…"
        className="mb-4 w-full border border-hairline bg-transparent px-3 py-1.5 text-sm text-fg placeholder:text-muted/60 focus:border-amber focus:outline-none"
      />
      <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-muted">
        {shown.length} note{shown.length === 1 ? "" : "s"}
        {f ? ` · “${q.trim()}”` : ""}
      </p>
      <ul className="space-y-1">
        {shown.map((n) => {
          const dir = n.path.includes("/")
            ? n.path.slice(0, n.path.lastIndexOf("/"))
            : "";
          return (
            <li key={n.id} className="flex items-baseline gap-3">
              <Link
                href={`/vault/${n.id}`}
                className="shrink-0 text-sm text-fg hover:text-amber"
              >
                {n.title}
              </Link>
              <span className="min-w-0 flex-1 truncate text-[13px] text-muted/75">
                {n.preview || dir}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
