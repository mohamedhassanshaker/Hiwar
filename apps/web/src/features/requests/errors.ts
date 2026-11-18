import { Rejected } from "@/lib/rejection";
import { type FlowProblem } from "./flow";

/** `COM-12`: a dynamic attribute is checked against the pinned version before it is stored. */
export class AttributeError extends Rejected {
  readonly code = "ATTRIBUTE_INVALID";
  constructor(
    readonly field: string,
    message: string,
    messageAr: string,
  ) {
    super(message, messageAr);
    this.name = "AttributeError";
  }
}

/** Raised when a request type cannot be published, carrying every reason at once. */
export class FlowNotPublishable extends Rejected {
  constructor(readonly problems: FlowProblem[]) {
    super(
      problems.map((problem) => problem.message).join(" "),
      problems.map((problem) => problem.messageAr).join(" "),
    );
    this.name = "FlowNotPublishable";
  }
}

/** Thrown when a designer change is refused, for a reason the screen should show. */
export class RequestTypeRejected extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "RequestTypeRejected";
  }
}

/** Thrown when an act on a request is refused, for a reason the screen should show. */
export class RequestRejected extends Rejected {
  constructor(message: string, messageAr: string) {
    super(message, messageAr);
    this.name = "RequestRejected";
  }
}
