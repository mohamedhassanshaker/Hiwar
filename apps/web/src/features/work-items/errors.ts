import { Rejected } from "@/lib/rejection";

/** Thrown when a work item change is refused, with the reason the screen shows. */
export class WorkItemRejected extends Rejected {
  constructor(
    message: string,
    messageAr: string,
    /** `UC-24.3-05`: the open items this one looks like. */
    readonly similar: { key: string; titleEn: string }[] = [],
  ) {
    super(message, messageAr);
    this.name = "WorkItemRejected";
  }
}
