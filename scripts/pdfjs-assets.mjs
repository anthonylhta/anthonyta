// Copies the pdf.js runtime assets the inbox viewer loads at RUNTIME — the
// worker, the wasm image decoders (JBIG2/JPX/ICC, which scanned PDFs need), the
// standard fonts and the CMaps — out of the installed package into public/pdfjs/,
// so they serve same-origin (CSP: worker-src 'self', connect-src 'self') and stay
// byte-locked to the pdfjs-dist version in the lockfile. Runs on postinstall;
// public/pdfjs/ is gitignored — nothing binary is committed.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist");
const out = join(root, "public", "pdfjs");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(src, "build", "pdf.worker.min.mjs"), join(out, "pdf.worker.min.mjs"));
for (const dir of ["wasm", "standard_fonts", "cmaps"])
  cpSync(join(src, dir), join(out, dir), { recursive: true });
console.log(`pdfjs assets → public/pdfjs (worker, wasm, standard_fonts, cmaps)`);
