import { Rejected } from "@/lib/rejection";

/** Thrown when an act in a room is refused, for a reason the screen should show. */
export class RoomRejected extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "RoomRejected";
  }
}
