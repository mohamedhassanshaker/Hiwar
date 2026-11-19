import { Rejected } from "@/lib/rejection";

/** Thrown when a memory change is refused, for a reason the screen should show. */
export class MemoryRejected extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "MemoryRejected";
  }
}
