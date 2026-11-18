-- A room's Owner can make other people in it Admins (D392): an Admin manages the room's
-- participants and its turn-taking, a plain Member does not. The role is one more value of
-- the participant role; no existing row changes.
ALTER TABLE "work"."room_participant" DROP CONSTRAINT "room_participant_role_check";
--> statement-breakpoint
ALTER TABLE "work"."room_participant" ADD CONSTRAINT "room_participant_role_check"
  CHECK ("room_role" in ('Owner', 'Admin', 'Member', 'LeadAgent', 'MemberAgent', 'Observer'));
