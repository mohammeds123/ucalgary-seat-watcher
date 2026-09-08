import { describe, expect, it } from "vitest";

import { TransitionDetector } from "../src/domain/transitions.js";

const snap = (classNbr: string, status: "open" | "closed" | "waitlist") => ({
  classNbr,
  status,
});

describe("TransitionDetector", () => {
  it("does not alert on the first sighting, even if already open", () => {
    const d = new TransitionDetector();
    // Otherwise every newly-watched course fires an alert the moment it is added.
    expect(d.observe([snap("71003", "open")])).toEqual([]);
  });

  it("alerts on closed -> open", () => {
    const d = new TransitionDetector();
    d.observe([snap("71003", "closed")]);
    expect(d.observe([snap("71003", "open")])).toEqual([
      { classNbr: "71003", from: "closed", to: "open" },
    ]);
  });

  it("alerts on waitlist -> open", () => {
    const d = new TransitionDetector();
    d.observe([snap("71003", "waitlist")]);
    expect(d.observe([snap("71003", "open")])).toEqual([
      { classNbr: "71003", from: "waitlist", to: "open" },
    ]);
  });

  it("alerts exactly once while a class stays open", () => {
    const d = new TransitionDetector();
    d.observe([snap("71003", "closed")]);

    expect(d.observe([snap("71003", "open")])).toHaveLength(1);
    for (let i = 0; i < 20; i++) {
      // Twenty more polls, still open. Silence.
      expect(d.observe([snap("71003", "open")])).toEqual([]);
    }
  });

  it("alerts again after the class closes and reopens", () => {
    const d = new TransitionDetector();
    d.observe([snap("71003", "closed")]);
    expect(d.observe([snap("71003", "open")])).toHaveLength(1);
    d.observe([snap("71003", "closed")]);
    expect(d.observe([snap("71003", "open")])).toHaveLength(1);
  });

  it("does not alert on closed -> waitlist", () => {
    // Gaining a waitlist is not a seat opening.
    const d = new TransitionDetector();
    d.observe([snap("71003", "closed")]);
    expect(d.observe([snap("71003", "waitlist")])).toEqual([]);
  });

  it("tracks classes independently", () => {
    const d = new TransitionDetector();
    d.observe([snap("A", "closed"), snap("B", "closed")]);
    const events = d.observe([snap("A", "open"), snap("B", "closed")]);
    expect(events).toEqual([{ classNbr: "A", from: "closed", to: "open" }]);
  });

  it("keeps history for classes missing from a poll", () => {
    // A search can transiently omit a section (paging, a filtered query).
    // Forgetting it would make the next sighting look like a first sighting and
    // suppress a real opening — or, after a re-add, duplicate one.
    const d = new TransitionDetector();
    d.observe([snap("A", "open"), snap("B", "closed")]);
    d.observe([snap("B", "closed")]); // A missing this round
    expect(d.observe([snap("A", "open")])).toEqual([]); // still baselined as open
    expect(d.current.get("A")).toBe("open");
  });

  it("forgets a class on request so re-adding it re-baselines", () => {
    const d = new TransitionDetector();
    d.observe([snap("A", "closed")]);
    d.forget("A");
    expect(d.observe([snap("A", "open")])).toEqual([]);
  });

  it("exposes current statuses for the popup", () => {
    const d = new TransitionDetector();
    d.observe([snap("A", "open"), snap("B", "waitlist")]);
    expect([...d.current]).toEqual([
      ["A", "open"],
      ["B", "waitlist"],
    ]);
  });
});
