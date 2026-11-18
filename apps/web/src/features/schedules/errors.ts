import { Rejected } from "@/lib/rejection";

/** Thrown when a schedule cannot be changed, for a reason the screen should show. */
export class ScheduleRejected extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "ScheduleRejected";
  }
}
