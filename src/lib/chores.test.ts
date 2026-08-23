import { describe, expect, it } from "vitest";
import { choreState, daysSince, overdueChores } from "./chores";

const NOW = new Date("2026-07-17T09:00:00+10:00");

describe("daysSince", () => {
  it("whole days, floored, never negative", () => {
    expect(daysSince("2026-07-17T08:00:00+10:00", NOW)).toBe(0);
    expect(daysSince("2026-07-14T09:00:00+10:00", NOW)).toBe(3);
    // Bare dates parse as UTC midnight (see the lib doc): 07-10T00:00Z →
    // 07-16T23:00Z is 6.96 days, floored to 6.
    expect(daysSince("2026-07-10", NOW)).toBe(6);
    expect(daysSince("2026-07-18T09:00:00+10:00", NOW)).toBe(0);
  });

  it("null on missing or unparseable", () => {
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince("not a date", NOW)).toBeNull();
  });
});

describe("choreState", () => {
  it("ok under the cadence", () => {
    expect(choreState("2026-07-14T09:00:00+10:00", 7, NOW)).toEqual({
      ageDays: 3,
      status: "ok",
    });
  });

  it("due at the cadence, overdue at twice it", () => {
    expect(choreState("2026-07-09T09:00:00+10:00", 7, NOW).status).toBe("due");
    expect(choreState("2026-07-02T09:00:00+10:00", 7, NOW).status).toBe(
      "overdue",
    );
  });

  it("unknown with no record", () => {
    expect(choreState(null, 7, NOW)).toEqual({
      ageDays: null,
      status: "unknown",
    });
  });
});

describe("overdueChores", () => {
  /** Days before NOW, as an ISO instant the connector could plausibly return. */
  const ago = (days: number) =>
    new Date(NOW.getTime() - days * 86_400_000).toISOString();

  const fresh = { vaultSync: ago(1), backup: ago(2), aperture: ago(1) };

  it("says nothing while everything is inside its cadence", () => {
    expect(overdueChores(fresh, NOW)).toEqual([]);
  });

  it("ignores the amber middle — due is the board's job, not a push", () => {
    // vault-sync's cadence is 4d: 5d is due, 8d is overdue.
    expect(overdueChores({ ...fresh, vaultSync: ago(5) }, NOW)).toEqual([]);
    expect(overdueChores({ ...fresh, vaultSync: ago(8) }, NOW)).toEqual([
      { label: "vault-sync", days: 8, command: "npm run vault-sync" },
    ]);
  });

  it("never counts a missing record as neglect", () => {
    expect(
      overdueChores({ vaultSync: null, backup: null, aperture: null }, NOW),
    ).toEqual([]);
  });

  it("names the whole red set in the board's order, with each command", () => {
    expect(
      overdueChores(
        { vaultSync: ago(9), backup: ago(62), aperture: ago(15) },
        NOW,
      ),
    ).toEqual([
      { label: "vault-sync", days: 9, command: "npm run vault-sync" },
      { label: "backup", days: 62, command: "npm run hub-backup" },
      // The seal's action is the weekly check-in, so it carries no command.
      { label: "aperture seal", days: 15, command: null },
    ]);
  });

  it("only turns red at twice the cadence, per chore", () => {
    // backup is monthly — 31d is due, not overdue; the seal at 14d already is.
    expect(
      overdueChores({ ...fresh, backup: ago(31), aperture: ago(14) }, NOW).map(
        (c) => c.label,
      ),
    ).toEqual(["aperture seal"]);
  });
});
