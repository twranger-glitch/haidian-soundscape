# ASTRA dev37.9.8.5 — incomplete-comparison display fallback

Baseline: dev37.9.8.4 positive-only precedence guard.

## User-visible bug fixed
- When comparison proof returned `selected=null` / `best=null` because shade intervals overlap, the UI returned early from `renderCandidateBundle()` and rendered no route at all, even though multiple eligible candidates were already fully scored.
- The comparator was correct; the display path incorrectly treated “no proven winner” as “no route to display”.

## Production change
- `src/route-exposure.js`: display selection is now separate from proof selection. If there is no proven winner, the UI displays the current active eligible candidate (otherwise the first eligible scored candidate) while leaving `selected` / `best` null.
- All other scored candidates remain visible as outlines/cards and can be switched manually.
- Warning text explicitly states that no true “最不曬” winner has been proven.
- Deferred evidence loading follows the displayed candidate instead of requiring `bundle.best`.
- `index.html`: only the `route-exposure.js` cache query is bumped to `core=37.9.8.5`.

## Safety invariants
- `compareExposureBounds()` is byte-identical to dev37.9.8.4.
- No comparator relaxation, unknown→sun/shade promotion, source precedence change, candidate-generation change, detour change, or benchmark hardcoding.
- dev37.9.8.4 building provider safety guard is unchanged.

## Offline checks
- `node tests/test-route-display-fallback.js`: PASS.
- `node tests/test-nlsc-official-geometry.js`: PASS, 14 checks.
- `node --check src/route-exposure.js`: PASS.
- Comparator function SHA256 remains `2a4eefe7e5b106d309e0ba27fd9ca16e2cc73cb5ea409d6be85836bbd7e5c97c`, identical to dev37.9.8.4.

Live browser acceptance remains required.
