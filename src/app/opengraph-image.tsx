import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SITE_TAGLINE } from "@/lib/site";

/**
 * The site's Open Graph / Twitter share card, rendered through next/og (Satori).
 * Warm Terminal in a flexbox subset: `> whoami` → name → tagline with a cursor,
 * a status line, and the surface tags + domain. Generated at build time (no
 * request-time APIs), so it's a static, cached PNG.
 *
 * Satori needs a raw font; Geist Mono (the hub's mono identity) is bundled at
 * `assets/` and read here — `next/font` doesn't expose a usable TTF for this.
 */
export const alt = "Anthony Ta — builder · languages · markets";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#0e0d0b";
const FG = "#e8e2d4";
const MUTED = "#a39a86";
const AMBER = "#f5a524";
const GREEN = "#7fd17f";
const HAIR = "#2a2519";

export default async function Image() {
  const geistMono = await readFile(
    join(process.cwd(), "assets/GeistMono-Regular.ttf"),
  );

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: "52px 72px",
        backgroundColor: BG,
        color: FG,
        fontFamily: "Geist Mono",
      }}
    >
      {/* status bar */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 26,
            color: MUTED,
            marginBottom: 26,
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                backgroundColor: GREEN,
                marginRight: 14,
              }}
            />
            anthony@hub:~/lobby
          </div>
          <div style={{ color: AMBER }}>live ●</div>
        </div>
        <div style={{ height: 1.5, backgroundColor: HAIR }} />
      </div>

      {/* prompt → name → tagline */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          justifyContent: "center",
        }}
      >
        <div style={{ display: "flex", fontSize: 34, marginBottom: 20 }}>
          <div style={{ color: AMBER }}>&gt;</div>
          <div style={{ color: MUTED, marginLeft: 14 }}>whoami</div>
        </div>
        <div style={{ fontSize: 100, color: FG, marginBottom: 12 }}>
          anthony ta
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ fontSize: 40, color: MUTED }}>{SITE_TAGLINE}</div>
          <div
            style={{
              width: 18,
              height: 44,
              backgroundColor: AMBER,
              marginLeft: 16,
            }}
          />
        </div>
      </div>

      {/* surface tags + domain */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ height: 1.5, backgroundColor: HAIR }} />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 27,
            marginTop: 24,
          }}
        >
          <div style={{ color: MUTED }}>
            reading · riichi · briefing · translator · novels
          </div>
          <div style={{ color: AMBER }}>anthonyta.dev</div>
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: "Geist Mono", data: geistMono, weight: 400, style: "normal" },
      ],
    },
  );
}
