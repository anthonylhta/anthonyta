import { notFound } from "next/navigation";
import { ShareView } from "./ShareView";

// A share link is public and one-off — no auth gate, and the ciphertext must be
// fetched live (never cached), so render on every request.
export const dynamic = "force-dynamic";

export const metadata = { title: "shared file" };

// `<expiry(10 digits)>-e-<22 url-safe chars>` — the exact blob segment shape the
// owner minted. Anything else is a typo or a probe → 404, no server work.
const SEGMENT = /^\d{10}-e-[A-Za-z0-9_-]{22}$/;

export default async function SharePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!SEGMENT.test(id)) notFound();

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-6">
      <div className="border border-hairline bg-surface/20 px-5 py-6 font-mono">
        <p className="text-xs tracking-[0.2em] text-muted uppercase">
          shared file
        </p>
        <h1 className="mt-2 text-base text-fg">a file was shared with you</h1>
        <p className="mt-1 text-xs text-muted">
          it decrypts in your browser — the key rides in this link and never
          reaches the server.
        </p>

        <div className="mt-5">
          <ShareView id={id} />
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-muted/60">
        the hub · warm terminal
      </p>
    </main>
  );
}
