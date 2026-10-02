# ASTRA dev37.9.9.9 — Search / Comparator Proof-Scope Alignment

Baseline: live-accepted dev37.9.9.8 generic Realm walkability.

The dev37.9.9.8 live acceptance proved the generic inferred-open-space model works on the saved Xiaoqiao control: the min-sun candidate `g12a3dbe9` is eligible, its direct-sun interval is strictly below the generated fastest candidate, and the UI correctly preserves on-site confirmation. The same live diagnostics also exposed a proof-scope mismatch: the final dense comparator reported a valid winner over the **generated candidate set** while Realm search itself still reported `termination=uncertain-ordering` / `orderingProved=false`.

This release fixes that semantic mismatch without changing route generation, Realm search, walkability inference, shade modeling, detour rules, terminal rules, or the interval comparator math.

## New comparison semantics

- `compareExposureBounds()` remains unchanged and still proves interval separation among the candidates it receives.
- `scoreCandidates()` now keeps candidate-set proof separate from search-coverage proof.
- If any eligible Realm shade candidate carries `searchIncomplete=true` or `graphMeta.shadeSearchComplete=false`, a candidate-set interval winner is retained as `provisionalSelected` / `candidateSetSelected`, but `selected`, `best`, and `comparisonValid` remain null/false.
- The bundle reports `comparisonState="candidate-set-only"`, `candidateSetComparisonValid=true`, `searchCoverageComplete=false`, and `comparisonProof.scopeStatus="candidate-set-proved-search-incomplete"`.
- `activeCandidateId` still points at the provisional candidate, so the useful route remains visible.
- The UI explicitly says the route is proven better **among the currently generated candidates**, while Realm search coverage is incomplete; it no longer presents that state as a globally proven minimum-exposure route.

## Why this is required

The accepted dev37.9.9.8 live frame had:

- min-sun interval: `26.9106313262–36.4335516095 s`;
- generated fastest interval: `64.1016795023–73.7662008026 s`;
- candidate-set separation margin: about `27.668 s`;
- Realm search diagnostics: `orderingProved=false`, `termination=uncertain-ordering`.

Those facts are compatible: the min-sun route is strongly better than the generated fastest route, but the search has not certified complete coverage of every possible remaining Realm route. dev37.9.9.9 preserves both facts instead of conflating them.

## Verification

Offline regression checks: **215 PASS / 0 FAIL**:

- provenance / inference: 65
- inferred walkability comparator controls: 19
- exact live geometry replay: 1
- terminal continuity: 11
- endpoint normalization: 22
- terminal safety: 22
- residual/comparator preservation: 32
- NLSC geometry: 14
- display fallback: 1
- weighted-seed reproducibility: 2
- new proof-scope alignment controls: 26

The new controls verify both directions: incomplete search => provisional candidate-set winner with no formal selection; complete search => the same interval proof may produce a normal `comparisonValid=true` selection.

## Preserved invariants

Unchanged: graph core dev37.9.9.8, 8 m terminal gate, 10 m normalization offer maximum, 1.8 m Realm boundary policy, explicit consent/reference exclusion, weighted-seed/exact search, route geometry, generic inferred-open-space classification, source-supported/inferred accounting, detour policy, shade/unknown model, NLSC semantics, interval proof formula, and production graph mutation policy.
