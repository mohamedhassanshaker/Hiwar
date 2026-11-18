"use client";

import Image from "next/image";

import { JumanLogo, jumanLogoImage } from "@/components/shared/juman-logo";
import { isRenderableImage } from "@/lib/branding";

export type Logos = { logoLight: string | null; logoDark: string | null };

/**
 * The organisation's logo from Settings → Branding (`UC-75.2-01`), or the Juman mark when
 * none is uploaded. Each theme has its own logo; with only one uploaded it serves both.
 */
export function BrandLogo({
  logos,
  theme,
  lang,
  h = 40,
  alt,
  printable = false,
}: {
  logos: Logos;
  theme: string;
  lang: string;
  h?: number;
  alt: string;
  /** D388: draw the Juman mark as an image, which a printed page repeats whole. */
  printable?: boolean;
}) {
  const uploaded =
    [theme === "dark" ? logos.logoDark : logos.logoLight, theme === "dark" ? logos.logoLight : logos.logoDark].find(
      isRenderableImage,
    ) ?? null;
  if (!uploaded && printable) {
    return <Image src={jumanLogoImage(lang)} alt={alt} width={(h * 600) / 150} height={h} unoptimized style={{ display: "block" }} />;
  }
  return uploaded ? (
    // A plain `img`: the asset is a data URL held in the database, with no loader to optimise.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={uploaded} alt={alt} style={{ height: h, maxWidth: 180, objectFit: "contain", display: "block" }} />
  ) : (
    <JumanLogo lang={lang} h={h} />
  );
}
