import { Rejected } from "@/lib/rejection";

/** Thrown when a knowledge change is refused, for a reason the screen should show. */
export class KnowledgeRejected extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "KnowledgeRejected";
  }
}
