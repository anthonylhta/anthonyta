import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { AuthForm } from "@/components/auth-buttons";
import { Beacon } from "@/components/Beacon";
import { KeyShortcut } from "@/components/key-shortcut";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { CommandPaletteProvider } from "@/components/terminal/CommandPalette";
import { nav } from "@/lib/mock";
import {
  GITHUB_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL,
} from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_TITLE = `${SITE_NAME} — ${SITE_TAGLINE}`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // Home is the full title; inner pages set their own (e.g. "vault") and the
  // template suffixes the brand. The OG image (app/opengraph-image.tsx) is picked
  // up automatically for both og:image and twitter:image.
  title: { default: SITE_TITLE, template: "%s · anthony ta" },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: "en_AU",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  // Installed-to-home-screen behaviour on iOS: run standalone (no Safari chrome)
  // under the hub's own title. The manifest (app/manifest.ts) and the icon routes
  // are auto-linked by Next's file conventions.
  appleWebApp: {
    capable: true,
    title: SITE_NAME,
    statusBarStyle: "black-translucent",
  },
};

// Warm charcoal address bar / splash to match the shell (Next wants theme color
// in the viewport export, not metadata). The hub is dark-only by design.
export const viewport: Viewport = {
  themeColor: "#0e0d0b",
  colorScheme: "dark",
};

// JSON-LD Person — static, controlled data (no user input), the Next-recommended
// way to ship structured data; makes the site eligible for a rich identity result.
const personLd = {
  "@context": "https://schema.org",
  "@type": "Person",
  name: SITE_NAME,
  url: SITE_URL,
  jobTitle: "Software developer",
  description: SITE_DESCRIPTION,
  sameAs: [GITHUB_URL],
};

// ⌘K destinations — real pages only; unbuilt nav routes join once `ready` (mock.ts).
const paletteItems = [
  { label: "hub", href: "/", hint: "home" },
  { label: "briefing", href: "/briefing", hint: "markets" },
  { label: "today's hand", href: "/riichi", hint: "riichi" },
  { label: "ishin", href: "/ishin", hint: "japanese ⇄ english" },
  ...nav.filter((n) => n.ready).map((n) => ({ label: n.label, href: n.href })),
];

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Reading headers() forces dynamic rendering, which per-request nonces require
  // (the accepted cost). The JSON-LD script below is non-executing but carries the
  // nonce so the layout consumes the proxy's x-nonce header exactly once.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {/* Structured identity for crawlers; static JSON, so the inline script is safe. */}
        <script
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: JSON.stringify(personLd) }}
        />
        {/* ⌘K is global — the provider owns the modal + key listener; the visible
            trigger (<CommandK/>) lives in the page footers. */}
        <CommandPaletteProvider items={paletteItems}>
          {children}
        </CommandPaletteProvider>
        <AuthForm />
        <KeyShortcut />
        {/* Self-hides unless the app is installable and not already installed. */}
        <InstallPrompt />
        {/* Cookieless pageview beacon — same-origin POST; the route ignores bots,
            DNT, and the owner's own traffic, so it's harmless everywhere. */}
        <Beacon />
      </body>
    </html>
  );
}
