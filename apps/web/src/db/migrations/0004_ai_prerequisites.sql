-- The AI capabilities module's prerequisites (its infra/postgres/01-extensions.sql): extensions and
-- the search-key normaliser its generated search_key columns call. pg_stat_statements is left out:
-- it needs shared_preload_libraries, which the local image does not set.


CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gin;--> statement-breakpoint

-- `unaccent()` is STABLE because it reads a dictionary, so a generated column cannot call
-- it directly. This wrapper pins the dictionary by name, which makes it IMMUTABLE for our
-- purposes: the dictionary is part of the image and never changes under a running cluster.
CREATE OR REPLACE FUNCTION public.awp_unaccent(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE STRICT
AS $$
  SELECT public.unaccent('public.unaccent'::regdictionary, input)
$$;--> statement-breakpoint

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
$$;--> statement-breakpoint

COMMENT ON FUNCTION public.awp_normalise(text) IS
  'Search-key normaliser: Arabic letter-form folding, diacritic removal, unaccent, lowercase.';--> statement-breakpoint
