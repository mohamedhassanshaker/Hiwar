/** A person as signing in needs them (D387). */
export type SignInPerson = { id: string; email: string; nameEn: string; nameAr: string; status: string; emiratesId: string | null };

/** A UAE PASS account waiting in this browser to be linked with the password (manual linking). */
export type PendingUaePass = { uuid: string; idn: string | null; nameEn: string; nameAr: string };
