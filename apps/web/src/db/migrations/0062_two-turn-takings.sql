-- A room's turn-taking is Mention only or Autonomous (D289). A Lead agent or Round robin room
-- answered a message that named nobody, which an Autonomous room does; a Moderated room
-- answered only the agent a person named, which a Mention only room does.
UPDATE "work"."discussion_room" SET "turn_taking" = 'Autonomous', "updated_at" = now()
 WHERE "turn_taking" IN ('LeadAgent', 'RoundRobin');
--> statement-breakpoint
UPDATE "work"."discussion_room" SET "turn_taking" = 'MentionOnly', "updated_at" = now()
 WHERE "turn_taking" = 'Moderated';
--> statement-breakpoint
ALTER TABLE "work"."discussion_room" DROP CONSTRAINT "discussion_room_turn_taking_check";
--> statement-breakpoint
ALTER TABLE "work"."discussion_room" ADD CONSTRAINT "discussion_room_turn_taking_check"
  CHECK ("turn_taking" IN ('MentionOnly', 'Autonomous'));
--> statement-breakpoint
-- Autonomous is no longer behind a flag: it is one of the two policies every room may use.
DELETE FROM "gov"."feature_flag" WHERE "key" = 'autonomous-turn-taking-in-discussion-rooms';
