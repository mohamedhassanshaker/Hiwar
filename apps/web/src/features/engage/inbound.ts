/**
 * What a channel does with an inbound message (`UC-61.1-04`, `-07`, `-08`, `-09`, `-10`).
 *
 * The decision is here, apart from the database, because the same rules apply to a WhatsApp
 * webhook, a Teams activity and the web widget, and because the Test channel screen asks
 * "what would happen to a message right now?" without writing anything.
 */

import { LIVE_CHANNEL_TYPES } from "@/db/schema/enums";

export type InboundConditions = {
  channelType: string;
  isEnabled: boolean;
  businessHours: string;
  unknownSenders: string;
  /** False when the sender is not a person or an external contact the platform knows. */
  senderKnown: boolean;
  rateLimitPerMinute: number;
  /** How many messages this sender has already sent in the trailing minute. */
  messagesInLastMinute: number;
  /** ISO weekday of the message, Monday 1 … Sunday 7, in the organisation's time zone. */
  weekday: number;
  /** Minutes since midnight, in the organisation's time zone. */
  minuteOfDay: number;
  workingDays: number[];
  isHoliday: boolean;
  /** `08:00`/`17:00` from the working calendar, or null when it does not set hours. */
  workingHours: { start: string; end: string } | null;
};

export type InboundDecision =
  /** Handled live by the binding. */
  | { action: "Process" }
  /** Out of hours: the sender is told, and the binding still takes the message in. */
  | { action: "Offline"; detail: string }
  /** Answered with a notice and not handled. */
  | { action: "Throttled"; detail: string }
  /** Not handled at all, and recorded as dropped. */
  | { action: "Dropped"; reason: "ComingSoon" | "ChannelDisabled" | "UnknownSender"; detail: string };

function minutes(clock: string): number {
  const [hours, rest] = clock.split(":");
  return Number(hours) * 60 + Number(rest ?? 0);
}

/**
 * The one decision an inbound message gets.
 *
 * Order matters: a channel nobody turned on never reaches the rate limiter, and a sender the
 * platform is told to ignore is dropped before the working calendar is consulted, so the
 * ignore policy cannot leak an out-of-hours reply to an unknown number.
 */
export function inboundDecision(conditions: InboundConditions): InboundDecision {
  if (!(LIVE_CHANNEL_TYPES as readonly string[]).includes(conditions.channelType)) {
    return { action: "Dropped", reason: "ComingSoon", detail: `${conditions.channelType} is not available yet.` };
  }
  if (!conditions.isEnabled) {
    return { action: "Dropped", reason: "ChannelDisabled", detail: `The ${conditions.channelType} channel is turned off.` };
  }
  if (!conditions.senderKnown && conditions.unknownSenders === "Ignore") {
    return { action: "Dropped", reason: "UnknownSender", detail: "Unknown senders are ignored on this channel." };
  }
  if (conditions.messagesInLastMinute >= conditions.rateLimitPerMinute) {
    return {
      action: "Throttled",
      detail: `More than ${conditions.rateLimitPerMinute} messages in a minute.`,
    };
  }
  if (conditions.businessHours === "WorkingCalendar") {
    if (conditions.isHoliday) return { action: "Offline", detail: "Today is a public holiday." };
    if (!conditions.workingDays.includes(conditions.weekday)) return { action: "Offline", detail: "Today is not a working day." };
    if (conditions.workingHours) {
      const from = minutes(conditions.workingHours.start);
      const to = minutes(conditions.workingHours.end);
      if (conditions.minuteOfDay < from || conditions.minuteOfDay >= to) {
        return { action: "Offline", detail: `Outside ${conditions.workingHours.start}–${conditions.workingHours.end}.` };
      }
    }
  }
  return { action: "Process" };
}

/** What a sender is told when the decision is not Process. */
export const INBOUND_NOTICE: Record<string, [string, string]> = {
  Offline: [
    "We are outside working hours. Your message has been taken in and someone will come back to you.",
    "نحن خارج ساعات العمل. تم استلام رسالتك وسيتم الرد عليك.",
  ],
  Throttled: [
    "You are sending messages faster than we can answer. Please wait a moment.",
    "ترسل الرسائل أسرع مما يمكننا الرد. يرجى الانتظار لحظة.",
  ],
};
