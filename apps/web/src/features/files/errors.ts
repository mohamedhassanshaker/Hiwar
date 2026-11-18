import { Rejected } from "@/lib/rejection";

/** Thrown when an upload or a change is refused, for a reason the screen should show. */
export class FileRejected extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "FileRejected";
  }
}
