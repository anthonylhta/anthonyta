/**
 * One exception line at the head of the sheet — the sheet's whole voice for
 * "something wants you". The home page is a SUMMARY: it carries the present
 * tense and nothing else, so a failing condition, an imminent tribulation, an
 * unadjudicated week or a stale seal each get one bordered line here and the
 * full reading stays on /aperture. A quiet week renders none of these at all,
 * which is the point — an empty exception band would be a row of padding
 * saying nothing.
 *
 * Two tones, the same two the rest of the hub allows itself: `down` for what is
 * actually going wrong, `amber` for what is merely owed. Nothing else, and never
 * the essence — an exception must not change colour with the rank.
 *
 * Deliberately free of any import, like ZoneHeader beside it: the masthead
 * renders these on the server (the seal's staleness is plaintext) and the sealed
 * island renders them in the browser (everything else is behind the key), so it
 * has to be safe in both.
 */
export function ExceptionLine({
  tone,
  children,
}: {
  tone: "down" | "amber";
  children: React.ReactNode;
}) {
  return (
    <p
      className={`mt-2 border px-2.5 py-1.5 text-xs ${
        tone === "down"
          ? "border-down/50 text-down"
          : "border-amber/50 text-amber"
      }`}
    >
      {children}
    </p>
  );
}
