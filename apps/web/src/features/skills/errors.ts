import { Rejected } from "@/lib/rejection";

/** Thrown when a package cannot be imported, for a reason the screen should show. */
export class SkillRejected extends Rejected {
  constructor(
    message: string,
    messageAr: string,
    /** Every reason, when more than one thing is wrong with the package. */
    readonly reasons: string[] = [],
  ) {
    super(message, messageAr);
    this.name = "SkillRejected";
  }
}

/** No such skill, or no such file in its package. */
export class SkillMissing extends SkillRejected {}

/** A file path that is not a plain path inside the package. */
export class BadPackagePath extends SkillRejected {}

/** The object store that holds skill packages is not configured. */
export class PackageStoreUnavailable extends SkillRejected {}
