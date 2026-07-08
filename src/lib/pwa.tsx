import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The home-screen app icon, rendered through next/og (Satori) so it shares the
 * OG card's identity (app/opengraph-image.tsx): the amber prompt glyph on warm
 * charcoal. One renderer feeds every surface — the manifest icons, the Apple
 * touch icon, and the browser tab icon — so they can never drift apart.
 *
 * `maskable` reserves the ~20% safe-zone Android's adaptive-icon mask can crop:
 * the charcoal fills the whole square (never transparent, or launchers punch a
 * hole) and the glyph shrinks toward the centre. A non-maskable icon keeps its
 * own rounded tile for platforms (iOS, tabs) that render the art as-is.
 */
const BG = "#0e0d0b"; // warm charcoal — matches --color-bg
const AMBER = "#f5a524"; // primary accent — matches --color-amber

export async function renderAppIcon(size: number, maskable = false) {
  const geistMono = await readFile(
    join(process.cwd(), "assets/GeistMono-Regular.ttf"),
  );

  // Maskable art lives inside the safe zone; a plain icon can breathe larger.
  const glyph = Math.round(size * (maskable ? 0.4 : 0.5));
  const block = Math.round(glyph * 0.66);
  const gap = Math.round(glyph * 0.16);
  const radius = maskable ? 0 : Math.round(size * 0.22);
  const pad = maskable ? Math.round(size * 0.14) : 0;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: BG,
        padding: pad,
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: BG,
          borderRadius: radius,
          fontFamily: "Geist Mono",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ fontSize: glyph, color: AMBER, lineHeight: 1 }}>
            &gt;
          </div>
          {/* the blinking prompt cursor, frozen solid for the icon */}
          <div
            style={{
              width: Math.round(block * 0.5),
              height: block,
              backgroundColor: AMBER,
              marginLeft: gap,
            }}
          />
        </div>
      </div>
    </div>,
    {
      width: size,
      height: size,
      fonts: [
        { name: "Geist Mono", data: geistMono, weight: 400, style: "normal" },
      ],
    },
  );
}
