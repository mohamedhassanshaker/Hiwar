import { z } from "zod";

import { SCHEDULE_REPEATS, WORK_ITEM_TYPES } from "@/db/schema/enums";

/** Requirement 32: the scheduled-work-item action inputs. */

export const setScheduleActiveInput = z.object({
  id: z.uuid(),
  active: z.boolean(),
  version: z.number().int().positive(),
});

export const runNowInput = z.object({ id: z.uuid() });

export type SetScheduleActiveInput = z.infer<typeof setScheduleActiveInput>;

/** `UC-31.2-01` … `-07`: what a scheduled work item must say before it is created. */
export const saveScheduleInput = z
  .object({
    /** Absent when creating; present when the modal was opened on an existing schedule. */
    id: z.uuid().optional(),
    titleEn: z.string().trim().min(1).max(200),
    titleAr: z.string().trim().min(1).max(200),
    projectKey: z.string().trim().min(1),
    /** A work item type, or a request type code when the schedule raises requests. */
    createsWorkItemType: z.enum(WORK_ITEM_TYPES).optional(),
    createsRequestTypeCode: z.string().trim().min(1).optional(),
    audienceType: z.enum(["Agent", "Person", "Group"]),
    /** An agent code, a person id or a group id, depending on the audience. */
    audience: z.string().trim().min(1),
    repeats: z.enum(SCHEDULE_REPEATS),
    eventName: z.string().trim().max(80).optional(),
    startDate: z.string().date(),
    timeOfDay: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM."),
    timeZone: z.string().trim().min(1).default("Asia/Dubai"),
    skipHolidaysAndWeekends: z.boolean().default(true),
    instructionsEn: z.string().trim().max(4000).optional(),
    instructionsAr: z.string().trim().max(4000).optional(),
  })
  // `UC-31.2-03`: an event schedule fires on an event, so it has to name one.
  .refine((input) => input.repeats !== "OnEvent" || Boolean(input.eventName), {
    path: ["eventName"],
    message: "Choose the event this fires on.",
  })
  // The data model allows exactly one of the two: a firing creates a work item or a request.
  .refine((input) => Boolean(input.createsWorkItemType) !== Boolean(input.createsRequestTypeCode), {
    path: ["createsWorkItemType"],
    message: "Choose either a work item type or a request type.",
  })
  ;

export const setAllSchedulesActiveInput = z.object({ active: z.boolean() });

export type SaveScheduleInput = z.infer<typeof saveScheduleInput>;
