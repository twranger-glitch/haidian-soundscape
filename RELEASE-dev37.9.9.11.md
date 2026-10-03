# ASTRA dev37.9.9.11 — dense route distance accounting alignment

This release fixes one route-exposure accounting inconsistency found by the Pingshi cross-site control.

`candidate.distanceM` and Realm provenance correctly included an admitted 1.9557 cm terminal connector, while dense `analysis.summary.totalDistanceM` silently omitted it because `buildSampleSegments()` discarded every geometry leg <= 5 cm. The connector itself remains unresolved walkability evidence and the candidate remains partial/ineligible; this release does not grant terminal access, infer a surface, or change any Realm provenance classification.

The dense sampler now drops only numerical-zero geometry (`<= 1e-6 m`) instead of physical sub-5 cm legs. Centimetre/millimetre route geometry therefore participates in walking-time and exposure sampling, while exact duplicate coordinates remain ignored.

Unchanged: 8 m terminal gate; 10 m normalization hard maximum; 1.8 m Realm boundary tolerance; dev37.9.9.10 cross-site hazard hardening; generic inferred-open-space policy; weighted-seed / exact Realm search; 12 s budget; detour; shade uncertainty; candidate-set/search-coverage proof separation; source-supported/inferred provenance accounting.
