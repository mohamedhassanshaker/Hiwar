-- Extensions and the search normaliser for the AWP domain database.
--
-- Stack specification 7.1 names the extensions; data model 1.1 asks for normalised search
-- keys built with `unaccent` plus an Arabic normalisation that folds the alef, yaa and
-- taa-marbuta forms and strips diacritics. This file runs before the Drizzle migrations,
-- because the generated `search_key` columns call `public.awp_normalise`.
--
-- Idempotent: safe to run on every deploy.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- `unaccent()` is STABLE because it reads a dictionary, so a generated column cannot call
-- it directly. This wrapper pins the dictionary by name, which makes it IMMUTABLE for our
-- purposes: the dictionary is part of the image and never changes under a running cluster.
CREATE OR REPLACE FUNCTION public.awp_unaccent(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE STRICT
AS $$
  SELECT public.unaccent('public.unaccent'::regdictionary, input)
$$;

-- Arabic normalisation, applied before unaccent and lowercasing:
--   أ إ آ ٱ  -> ا      alef forms
--   ى        -> ي      alef maqsura to yaa
--   ة        -> ه      taa marbuta to haa
--   ؤ ئ      -> و ي    hamza carriers
--   tatweel and the diacritics U+064B..U+0652, U+0670 are removed
CREATE OR REPLACE FUNCTION public.awp_normalise(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
AS $$
  SELECT lower(
    public.awp_unaccent(
      regexp_replace(
        translate(
          coalesce(input, ''),
          'أإآٱىةؤئـ',
          'اااايهوي'
        ),
        '[ً-ْٰ]',
        '',
        'g'
      )
    )
  )
$$;

COMMENT ON FUNCTION public.awp_normalise(text) IS
  'Search-key normaliser: Arabic letter-form folding, diacritic removal, unaccent, lowercase.';
