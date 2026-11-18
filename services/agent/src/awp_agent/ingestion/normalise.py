"""Arabic normalisation.

The same word is written several ways in Arabic — alef with and without hamza, yaa and alef
maqsura, taa marbuta and haa — and search keys have to match across all of them. The rules
below are the ones the data model's normalised search keys use, so a passage indexed here and
a name indexed in PostgreSQL normalise the same way.
"""

from __future__ import annotations

import re
import unicodedata

DIACRITICS = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭ]")
TATWEEL = "ـ"

ALEF_FORMS = str.maketrans({"آ": "ا", "أ": "ا", "إ": "ا"})
YAA_FORMS = str.maketrans({"ى": "ي", "ی": "ي"})
TAA_MARBUTA = str.maketrans({"ة": "ه"})
ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def normalise_arabic(text: str) -> str:
    """Normalise Arabic text for indexing and matching."""
    folded = unicodedata.normalize("NFKC", text)
    folded = DIACRITICS.sub("", folded)
    folded = folded.replace(TATWEEL, "")
    folded = folded.translate(ALEF_FORMS).translate(YAA_FORMS).translate(TAA_MARBUTA)
    return folded.translate(ARABIC_DIGITS)


def search_key(text: str) -> str:
    """The normalised, case-folded, whitespace-collapsed key of a name or a passage."""
    return re.sub(r"\s+", " ", normalise_arabic(text).casefold()).strip()
