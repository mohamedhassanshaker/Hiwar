import { Rejected } from "@/lib/rejection";

/** Thrown when a connector change is refused, for a reason the drawer should show. */
export class ConnectorRejected extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "ConnectorRejected";
  }
}
