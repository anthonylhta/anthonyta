import Link from "next/link";

/**
 * The lowkey door a section with a page of its own gets: the label itself is
 * the link, with a muted arrow so it reads as tappable on touch (no hover on a
 * phone). One shape, always in the same place — the left edge — so the right
 * edge stays free for a row's actions. Sections without a page render a plain
 * label and no arrow; the absence is the rule.
 */
export function LabelDoor({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="group text-muted transition-colors hover:text-amber"
    >
      {label}
      <span className="text-muted/45 transition-colors group-hover:text-amber">
        {" "}
        →
      </span>
    </Link>
  );
}
