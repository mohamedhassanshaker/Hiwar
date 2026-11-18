# Tahseel Design System — vendored copy

Copied unmodified from the Claude Design handoff bundle
`Tahseel_AWP-handoff.zip`, folder
`tahseel-awp/project/_ds/tahseel-design-system-dbb4cfbb-c345-4580-a284-ce257ad30c38/`.

Everything beside this file is the design system exactly as it was shipped:
`styles.css`, `tokens/`, `components/`, `assets/`, `fonts/`, `readme.md`,
`_ds_manifest.json`, `_adherence.oxlintrc.json` and `_ds_bundle.js`.

**These files are never edited by hand.** The console does not import
`_ds_bundle.js`; `npm run ds:generate` reads it and writes the trimmed ES module
at `src/ds/generated/ds-components.js`, which is the only build output derived
from this folder. To take a new design-system release, replace the whole folder
and run `npm run ds:generate` again.

`assets/payment-channels/`, `assets/rating/`, `assets/keypad/` and
`components/fig-assets.css` reference image files the handoff did not ship, so
those `url()` targets 404 — exactly as they do in the prototype. They belong to
components the console never renders.
