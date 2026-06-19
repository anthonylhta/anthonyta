import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { CommandPalette } from "@/components/terminal/CommandPalette";
import { nav } from "@/lib/mock";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "anthony ta",
  description: "builder · languages · markets — a personal hub.",
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
        {children}
        {/* ⌘K is global — present on every view, including the command center */}
        <div className="fixed bottom-4 right-4 z-40">
          <CommandPalette items={paletteItems} />
        </div>
      </body>
    </html>
  );
}
