import { describe, expect, it } from "vitest";
import { shareFailureLine, shareLandingLine } from "./sharelanding";

describe("shareFailureLine", () => {
  it("keeps the old line when the worker named no stage", () => {
    expect(shareFailureLine(undefined)).toBe(
      "share failed — file too large or store offline",
    );
  });
  it("names a body the phone couldn't read", () => {
    expect(shareFailureLine("form")).toBe(
      "the share couldn't be read on the phone — try fewer photos at once (form)",
    );
  });
  it("names a refused put, with the storage figure when it came", () => {
    expect(shareFailureLine("put:QuotaExceededError", "6", "812/900")).toBe(
      "the phone refused to hold the batch (812/900 MB used) — share fewer at once (put:QuotaExceededError · 6 files)",
    );
    expect(shareFailureLine("put:UnknownError", "3")).toBe(
      "the phone refused to hold the batch — share fewer at once (put:UnknownError · 3 files)",
    );
  });
  it("names an empty share", () => {
    expect(shareFailureLine("empty", "2")).toBe(
      "nothing arrived in the share — pick the photos again (empty · 2 files)",
    );
  });
  it("names a cache that wouldn't open", () => {
    expect(shareFailureLine("open", "4")).toBe(
      "the app's share cache wouldn't open — reopen the app and share again (open · 4 files)",
    );
  });
  it("names the server fallback", () => {
    expect(shareFailureLine("sw-miss")).toBe(
      "the app wasn't ready to take the share — open it once, then share again (sw-miss)",
    );
  });
  it("falls back to the old line for an unknown code, keeping the code", () => {
    expect(shareFailureLine("weird")).toBe(
      "share failed — file too large or store offline (weird)",
    );
  });
});

describe("shareLandingLine", () => {
  it("says nothing when everything arrived", () => {
    expect(shareLandingLine(5, 0, 5)).toBeNull();
  });
  it("says when nothing reached the tab", () => {
    expect(shareLandingLine(5, 0, 0)).toBe(
      "the shared photos didn't reach this tab — share again",
    );
  });
  it("names the files that failed to stash", () => {
    expect(shareLandingLine(4, 2, 4, "put:QuotaExceededError")).toBe(
      "stashed 4 · 2 failed to stash — share those again (put:QuotaExceededError)",
    );
  });
  it("names a short drain", () => {
    expect(shareLandingLine(5, 0, 3)).toBe(
      "drained 3 of 5 — share the rest again",
    );
  });
  it("names both at once", () => {
    expect(shareLandingLine(4, 2, 3)).toBe(
      "stashed 4 · 2 failed to stash · drained 3 of 4 — share the rest again",
    );
  });
  it("names leftovers from an earlier share", () => {
    expect(shareLandingLine(2, 0, 5)).toBe(
      "drained 5 · 3 left over from an earlier share",
    );
    expect(shareLandingLine(2, 1, 3)).toBe(
      "stashed 2 · 1 failed to stash · drained 3 · 1 left over from an earlier share — share those again",
    );
  });
  it("carries the code on the nothing-arrived line too", () => {
    expect(shareLandingLine(3, 1, 0, "put:QuotaExceededError")).toBe(
      "the shared photos didn't reach this tab — share again (put:QuotaExceededError)",
    );
  });
});
