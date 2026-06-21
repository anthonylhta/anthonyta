"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { VaultNote } from "@/lib/connectors/vault";

const PAGE = 14;

/** Compact, paginated, searchable note index — one screenful, dashboard-style. */
export function VaultList({ notes }: { notes: VaultNote[] }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);

  const f = q.trim().toLowerCase();
  const shown = useMemo(
    () => (f ? notes.filter((n) => n.path.toLowerCase().includes(f)) : notes),
    [notes, f],
  );
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const slice = shown.slice(cur * PAGE, cur * PAGE + PAGE);

  return (
    <div className="px-4 py-4">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(0);
        }}
        placeholder="search notes…"
        className="mb-3 w-full border border-hairline bg-transparent px-3 py-1.5 text-sm text-fg placeholder:text-muted/60 focus:border-amber focus:outline-none"
      />

      <ul className="min-h-[22rem] divide-y divide-hairline/40">
        {slice.map((n) => {
          const dir = n.path.includes("/")
            ? n.path.slice(0, n.path.lastIndexOf("/"))
            : "";
          return (
            <li key={n.id} className="flex items-baseline gap-3 py-1">
              <Link
                href={`/vault/${n.id}`}
                prefetch
                className="shrink-0 text-[13px] tabular-nums text-fg hover:text-amber"
              >
                {n.title}
              </Link>
              <span className="min-w-0 flex-1 truncate text-xs text-muted/70">
                {n.preview || dir}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex items-center justify-between text-[11px] text-muted">
        <button
          type="button"
          onClick={() => setPage(() => Math.max(0, cur - 1))}
          disabled={cur === 0}
          className="transition-colors hover:text-amber disabled:opacity-30 disabled:hover:text-muted"
        >
          ← prev
        </button>
        <span className="tabular-nums">
          {cur + 1} / {pages} · {shown.length} notes
        </span>
        <button
          type="button"
          onClick={() => setPage(() => Math.min(pages - 1, cur + 1))}
          disabled={cur >= pages - 1}
          className="transition-colors hover:text-amber disabled:opacity-30 disabled:hover:text-muted"
        >
          next →
        </button>
      </div>
    </div>
  );
}
