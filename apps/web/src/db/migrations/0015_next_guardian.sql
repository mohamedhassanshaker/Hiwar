ALTER TABLE "ai"."route" DROP CONSTRAINT "route_kind_check";--> statement-breakpoint
ALTER TABLE "ai"."route" ADD CONSTRAINT "route_kind_check" CHECK ("kind" in ('Standard', 'Typesafe', 'Voice', 'Embedding'));
