import { describe, expect, it } from "vitest";

import { inboundDecision, type InboundConditions } from "@/features/engage/inbound";

/**
 * S-61: what a channel does with a message that arrives.
 *
 * A channel is the one surface outside the console where a stranger can reach the platform,
 * so these rules decide whether anything runs at all.
 */

const conditions = (over: Partial<InboundConditions> = {}): InboundConditions => ({
  channelType: "WhatsApp",
  isEnabled: true,
  businessHours: "AlwaysOn",
  unknownSenders: "ExternalContact",
  senderKnown: true,
  rateLimitPerMinute: 30,
  messagesInLastMinute: 0,
  weekday: 1,
  minuteOfDay: 10 * 60,
  workingDays: [1, 2, 3, 4, 5],
  isHoliday: false,
  workingHours: { start: "08:00", end: "17:00" },
  ...over,
});

describe("an inbound channel message", () => {
  it("UC-61.1-02 a live, enabled channel inside its hours handles the message", () => {
    expect(inboundDecision(conditions())).toEqual({ action: "Process" });
  });

  it("UC-61.1-04 a channel that is switched off stops processing inbound messages", () => {
    expect(inboundDecision(conditions({ isEnabled: false }))).toMatchObject({ action: "Dropped", reason: "ChannelDisabled" });
  });

  it("UC-61.1-10 a channel that is not built yet never handles anything", () => {
    expect(inboundDecision(conditions({ channelType: "Slack", isEnabled: true }))).toMatchObject({
      action: "Dropped",
      reason: "ComingSoon",
    });
  });

  it("UC-61.1-08 an unknown sender is dropped where the policy says ignore, and taken in otherwise", () => {
    expect(inboundDecision(conditions({ senderKnown: false, unknownSenders: "Ignore" }))).toMatchObject({
      action: "Dropped",
      reason: "UnknownSender",
    });
    expect(inboundDecision(conditions({ senderKnown: false, unknownSenders: "ExternalContact" }))).toEqual({ action: "Process" });
  });

  it("UC-61.1-08 ignore wins over an out-of-hours reply, so nothing goes back to an unknown number", () => {
    const decision = inboundDecision(
      conditions({ senderKnown: false, unknownSenders: "Ignore", businessHours: "WorkingCalendar", minuteOfDay: 23 * 60 }),
    );
    expect(decision).toMatchObject({ action: "Dropped", reason: "UnknownSender" });
  });

  it("UC-61.1-09 a sender over the rate limit is throttled rather than handled", () => {
    expect(inboundDecision(conditions({ rateLimitPerMinute: 5, messagesInLastMinute: 5 }))).toMatchObject({ action: "Throttled" });
    expect(inboundDecision(conditions({ rateLimitPerMinute: 5, messagesInLastMinute: 4 }))).toEqual({ action: "Process" });
  });

  it("UC-61.1-07 the working calendar decides out of hours, by time, by day and by holiday", () => {
    const calendar = { businessHours: "WorkingCalendar" as const };
    expect(inboundDecision(conditions({ ...calendar, minuteOfDay: 7 * 60 + 59 })).action).toBe("Offline");
    expect(inboundDecision(conditions({ ...calendar, minuteOfDay: 17 * 60 })).action).toBe("Offline");
    expect(inboundDecision(conditions({ ...calendar, weekday: 7 })).action).toBe("Offline");
    expect(inboundDecision(conditions({ ...calendar, isHoliday: true })).action).toBe("Offline");
    expect(inboundDecision(conditions({ ...calendar, minuteOfDay: 8 * 60 }))).toEqual({ action: "Process" });
  });

  it("UC-61.1-07 a calendar that sets no hours still works by day", () => {
    const anyHour = conditions({ businessHours: "WorkingCalendar", workingHours: null, minuteOfDay: 2 * 60 });
    expect(inboundDecision(anyHour)).toEqual({ action: "Process" });
    expect(inboundDecision({ ...anyHour, weekday: 6 }).action).toBe("Offline");
  });
});
