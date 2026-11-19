import Link from "next/link";

/** Logo option A "Two voices" with the Latin and Arabic wordmarks (PLT-002 FR-001, FR-002, FR-010). */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="10" fill="#1b1f4b" />
      <path d="M12 8h9a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4h-6l-4 4v-4.2A4 4 0 0 1 8 16v-4a4 4 0 0 1 4-4z" fill="#ffffff" />
      <path
        d="M19 17h9a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4h-1v4l-4.5-4H19a4 4 0 0 1-4-4v-4a4 4 0 0 1 4-4z"
        fill="#14b8a6"
        stroke="#1b1f4b"
        strokeWidth="2"
      />
    </svg>
  );
}

export function Brand({ href = "/", light = false }: { href?: string; light?: boolean }) {
  return (
    <Link href={href} className="brand" aria-label="Hiwar home" style={light ? { color: "#fff" } : undefined}>
      <LogoMark />
      <span>Hiwar</span>
      <span className="ar" lang="ar" dir="rtl" style={light ? { color: "#14b8a6" } : undefined}>
        حوار
      </span>
    </Link>
  );
}
