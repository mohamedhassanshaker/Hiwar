import { Rejected } from "@/lib/rejection";

/** Thrown when a change to a provider, connection or route is refused, with the reason. */
export class ModelsRejected extends Rejected {
  constructor(
    message: string,
    messageAr: string,
    /** What the refusal is about — the routes that still use a connection, say. */
    readonly blockedBy: string[] = [],
  ) {
    super(message, messageAr);
    this.name = "ModelsRejected";
  }
}
