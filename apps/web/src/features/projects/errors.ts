import { Rejected } from "@/lib/rejection";

/** Thrown when a project change is refused, for a reason the screen should show. */
export class ProjectRejected extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "ProjectRejected";
  }
}
