# ASTRA dev37.9.8.4 — positive-only precedence safety guard

Baseline: dev37.9.7 expanded NLSC geometry pilot.

## Production change
- `src/building-data-provider.js`: NLSC positive-only official geometry is no longer allowed to whole-supersede unknown casters through the provider's identity/spatial precision-precedence indexes.
- Official NLSC geometry + reported BUILD_H remains additive positive shade evidence.
- Unknown Overture geometry/height/provenance remains represented unless an independent safe proof resolves it.
- No residual supersession, clipping, fabricated height, completeness inference, comparator relaxation, candidate-generation change, or benchmark hardcoding.

## Integration wiring
- Only the `building-data-provider.js` script cache query is bumped to `core=37.9.8.4` so browsers load the patched provider.
- Visible UI version remains `v9.0.0-dev37.8` by design.

## Verification before live deployment
- Max patch hash matched declared `CHANGED-FILES.json`.
- Original dev37.9.7 baseline: 25 PASS / 7 FAIL on the new safety regression, reproducing the unsafe whole-feature supersession cases.
- Patched core: 32 PASS / 0 FAIL.
- Existing NLSC geometry test: 14 checks PASS.
- Supplied live-evidence audit: 8 PASS / 0 FAIL.
- Browser/live benchmark: pending deployment acceptance.
