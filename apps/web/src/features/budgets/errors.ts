import { Rejected } from "@/lib/rejection";

/** Thrown when a budget is refused, with the reason the form shows. */
export class BudgetRejected extends Rejected {
  constructor(
    message: string,
    messageAr: string,
    /** `UC-71.1-07`: the window that clashes, so the admin can see which one. */
    readonly conflict?: { from: string; to: string | null },
  ) {
    super(message, messageAr);
    this.name = "BudgetRejected";
  }
}
