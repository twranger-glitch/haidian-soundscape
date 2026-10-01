# ASTRA dev37.9.9.6.1 — endpoint-normalization loss-ledger hotfix

Baseline: deployed dev37.9.9.6.

## Why this hotfix exists
The user-run live exact-endpoint acceptance reproduced the expected 9.880079907779448 m B terminal gap. Before consent, the original B remained rejected and only an explicit mapped-anchor offer was shown. After consent, the routing endpoint changed to the mapped anchor, the original B remained visible as an unverified reference, `referenceIncludedInMetrics=false`, and the resulting Realm route distance was 230.78066973243497 m.

That same live run exposed one diagnostic incompatibility: two candidates were intentionally rejected because they did not terminate at the user-confirmed routing endpoint, but dev32 candidate-loss accounting still reported `FAIL; unexplained 2`.

## Root cause
Endpoint normalization is a later lifecycle stage than ordinary candidate dedupe. The audit already recorded the later rejection as:

- `stage=endpoint-normalization`
- `status=rejected`
- `reason=does-not-reach-user-confirmed-routing-endpoint`

However, `finalizeCandidateAudit()` indexed the first dedupe event per stable candidate key. A prior `dedupe: kept` record therefore masked the later normalization rejection, leaving the candidate unexplained.

## Production change
- `src/route-exposure.js`: build a dedicated index of only the exact endpoint-normalization rejection reason and classify those generated candidates as explained hidden candidates.
- The normalization rejection event now also carries `stableCandidateId` and `geometryHash` for audit traceability.
- No other rejection reason is accepted or generalized.
- `index.html`: only `src/route-exposure.js` cache wiring is bumped to `core=37.9.9.6.1`. The pedestrian graph remains `core=37.9.9.6`.

## Semantics intentionally unchanged
No change to candidate generation, route geometry, dedupe proof, route-quality filters, detour cap, scoring, comparator, shade/unknown accounting, Realm search, 8 m terminal gate, 10 m offer envelope, 1.8 m Realm boundary tolerance, mapped-anchor eligibility, explicit-consent behavior, or production graph mutation rules.

## Regression proof
A new regression reproduces the real lifecycle ordering: ordinary `dedupe: kept` records occur first, then two endpoint-normalization rejections. dev37.9.9.6 fails this control (21 PASS / 1 expected FAIL); dev37.9.9.6.1 passes it.

Green verification on the patched tree:
- terminal handoff continuity: 11 PASS / 0 FAIL
- endpoint normalization + loss ledger: 22 PASS / 0 FAIL
- Realm terminal safety: 22 PASS / 0 FAIL
- provider/residual/comparator preservation: 32 PASS / 0 FAIL
- NLSC official geometry: 14 checks PASS
- display fallback: PASS
- syntax: 6 PASS / 0 FAIL

## Required live recheck after deployment
Repeat the same exact 9.880079907779448 m confirmed-anchor case and run `tests/LIVE-ACCEPTANCE-dev37.9.9.6.1.js`. The key expected result is:

- `route379961Loaded=true`
- `lossAccountingValid=true`
- `unexplainedLossCount=0`
- original endpoint reference still excluded from metrics
- comparator still does not fabricate a winner when evidence is incomplete
