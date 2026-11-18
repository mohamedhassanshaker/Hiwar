import { Rejected } from "@/lib/rejection";

/** Raised when a change is refused because of what the agent is, not who is asking. */
export class AgentNotEditable extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "AgentNotEditable";
  }
}

/** Thrown when a run cannot be started, for a reason the caller should see. */
export class RunNotStarted extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "RunNotStarted";
  }
}

/** A run whose credentials cannot be re-minted, and why. */
export class RunNotRefreshable extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "RunNotRefreshable";
  }
}

/** Thrown when an agent cannot be created, for a reason the form should show. */
export class AgentRejected extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "AgentRejected";
  }
}
