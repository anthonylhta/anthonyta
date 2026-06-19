// PreToolUse hook (Bash): when a `gh pr create` is about to run, first run the full
// CI-equivalent checks locally and BLOCK the PR if anything fails — so a red PR can't
// be opened. No-op for every other Bash command.
const { execSync } = require("child_process");

let data = "";
process.stdin.on("data", (c) => (data += c));
process.stdin.on("end", () => {
  let input = {};
  try {
    input = JSON.parse(data || "{}");
  } catch {
    process.exit(0);
  }
  const cmd = (input.tool_input && input.tool_input.command) || "";
  if (!cmd.includes("gh pr create")) process.exit(0);

  const cwd = input.cwd || process.cwd();
  try {
    // Mirror the CI workflow: typecheck, lint, tests, build.
    execSync("npm run check && npm run lint && npm run test && npm run build", {
      stdio: "pipe",
      cwd,
    });
    process.exit(0);
  } catch (e) {
    const out =
      (e.stdout ? e.stdout.toString() : "") +
      "\n" +
      (e.stderr ? e.stderr.toString() : "");
    process.stderr.write(
      "Pre-PR checks failed — PR not created. Fix these, then retry:\n\n" +
        out.slice(-3000),
    );
    // Exit 2 blocks the tool call and feeds this message back to Claude.
    process.exit(2);
  }
});
