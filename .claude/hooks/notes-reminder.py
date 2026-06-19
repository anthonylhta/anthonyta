#!/usr/bin/env python3
"""PostToolUse(Bash) hook: after a `git commit`, remind Claude to consider a notes/ entry.

Reads the hook payload on stdin, and if the Bash command was a git commit, prints a
JSON object whose `additionalContext` is injected back into Claude's context. Always
exits 0 so it can never block a tool call. See notes/README.md.
"""
import json
import re
import sys

REMINDER = (
    "A git commit just ran. Per the notes/ workflow (see notes/README.md), evaluate "
    "whether this commit warrants a new note:\n"
    "- An ADR in notes/decisions/ (next number is in README) if it embodies a "
    "non-obvious architecture/design/tooling decision with lasting consequences.\n"
    "- A bug write-up in notes/bugs/YYYY-MM-DD-<slug>.md if it fixed a bug that took real "
    "hunting (symptoms -> root cause -> how found -> fix -> lesson).\n"
    "Skip routine commits (typos, formatting, dep bumps, mechanical refactors, doc tweaks) "
    "- no note needed. If a note IS warranted: write it (append-only, immutable) and add a "
    "pointer line to notes/README.md. Use judgment; do not narrate this check to the user "
    "unless you actually write a note."
)


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return
    command = (data.get("tool_input") or {}).get("command", "") or ""
    # Match `git commit`, including `git -C <path> commit` and chained `&& git commit`.
    if not re.search(r"\bgit\b(?:\s+\S+)*?\s+commit\b", command):
        return
    # Ignore obvious non-mutating uses.
    if "--dry-run" in command:
        return
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PostToolUse",
                    "additionalContext": REMINDER,
                }
            }
        )
    )


if __name__ == "__main__":
    main()
