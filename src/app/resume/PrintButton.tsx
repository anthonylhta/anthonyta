"use client";

/** The crumb-row action that makes the page its own PDF — no hosted binary,
 *  the print stylesheet does the rest (globals.css, [data-page="resume"]). */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="text-amber hover:underline print:hidden"
    >
      [print / save pdf]
    </button>
  );
}
