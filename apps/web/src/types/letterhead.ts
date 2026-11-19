/** D388: a report's letterhead — the organisation's name, logos and brand colour, and who prepared it. */
export type Letterhead = {
  logos: { logoLight: string | null; logoDark: string | null };
  brandColour: string | null;
  organisation: { nameEn: string; nameAr: string };
  preparedBy: { en: string; ar: string };
};
