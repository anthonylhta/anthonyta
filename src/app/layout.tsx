import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthForm } from "@/components/auth-buttons";
import { KeyShortcut } from "@/components/key-shortcut";
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
  { label: "tone translator", href: "/translator", hint: "japanese" },
  ...nav.filter((n) => n.ready).map((n) => ({ label: n.label, href: n.href })),
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {/* Structured identity for crawlers; static JSON, so the inline script is safe. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(personLd) }}
        />
        {/* ⌘K is global — the provider owns the modal + key listener; the visible
            trigger (<CommandK/>) lives in the page footers. */}
        <CommandPaletteProvider items={paletteItems}>
          {children}
        </CommandPaletteProvider>
        <AuthForm />
        <KeyShortcut />
      </body>
    </html>
  );
}
