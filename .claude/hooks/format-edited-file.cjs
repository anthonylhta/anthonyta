// PostToolUse hook (Edit|Write|MultiEdit): auto-format the edited file with prettier
// so unformatted files can never reach CI's `prettier --check`. Never blocks an edit.
const { execSync } = require("child_process");

let data = "";
process.stdin.on("data", (c) => (data += c));
process.stdin.on("end", () => {
  try {
    const input = JSON.parse(data || "{}");
    const file = input.tool_input && input.tool_input.file_path;
    if (file) {
      // --ignore-unknown: silently skips files prettier doesn't handle.
      // Respects .prettierignore automatically.
      execSync(
        `npx prettier --write --ignore-unknown ${JSON.stringify(file)}`,
        {
          stdio: "ignore",
          cwd: input.cwd || process.cwd(),
        },
      );
    }
  } catch {
    // Formatting must never block an edit — swallow everything.
  }
  process.exit(0);
});
