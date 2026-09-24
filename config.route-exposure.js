/* Haidian Soundscape — Route Exposure configuration v9.0.0-dev34.5 Connectivity-aware Endpoint Snap */
window.HAIDIAN_ROUTE_EXPOSURE_CONFIG = {
  sampleSpacingM: 10,
  walkingSpeedKmh: 4.5,
  shadeConcurrency: 3,
  canopyTimeoutMs: 4200,
  heatNearNowMinutes: 90,
  routingBase: "https://routing.openstreetmap.de/routed-foot/route/v1/driving",
  routingTimeoutMs: 15000,
  routingAlternatives: true,
  detourCapPct: 30,
  maxDrawPoints: 80,
  maxRouteSamples: 420,
  autoEnableShade: true,
  fitCandidateRoute: true,
  manualRouteSnapToleranceM: 120,
  manualEndpointToleranceM: 120,
  exploreCandidates: false,
  exploreMaxRoutes: 6,
  maxScoredCandidates: 10,
  // dev27: expose the detached verified-fusion min-sun path as a normal comparison candidate.
  autoCompareVerifiedFusion: true,
  fusionFidelityThresholdM: 14,
  fusionFidelitySampleM: 10,
  // dev6: reject only true loop-return / reverse repeated-corridor waste; normal street detours remain allowed.
  routeQualityEnabled: true,
  routeQualitySampleM: 8,
  routeQualityLoopReturnRadiusM: 5,
  routeQualityMinLoopExcursionM: 70,
  routeQualityRepeatedCorridorRadiusM: 5,
  routeQualityRepeatedCorridorMinSeparationM: 40,
  routeQualityMaxRepeatedCorridorM: 32,
  routeQualityOppositeHeadingDeg: 155,
  // v9.0.0-dev33: route-local official evidence discovery + detached fusion on top of the locked dev32 correctness runtime; preserves production graph isolation
  // connectors diagnostic/manual-review only, and can cross-check the same benchmark
  // against mature pedestrian routing engines. No connector is written into production.
  // dev22–dev27: preprocessed multi-source evidence; dev27 adds nationwide lazy-loaded tiles. Browser never downloads national archives.
  // Cross-source connectors remain outside production; only verified source-following witnesses may enter a detached experimental clone.
  // dev27: nationwide official-data tiles.  Default deploy uses a real-data Haidian
  // regression sample; set manifestUrl/datasetBaseUrl to the Hugging Face Dataset
  // resolve/main URLs after publishing the nationwide dataset package.
  nationwideTiles: {
    enabled: true,
    // After publishing to a public Hugging Face Dataset, set only this repo id.
    // Example: "your-name/taiwan-shade-routing-tiles". No Cloudflare/R2 required.
    huggingFaceRepo: "yhzkiki/taiwan-shade-routing-data",
    huggingFaceRevision: "main",
    manifestUrl: "./data/nationwide-sample/manifest.json",
    datasetBaseUrl: "./data/nationwide-sample/",
    requestTimeoutMs: 15000,
    // dev30 keeps the staged HGR2 fast path: start with core tiles only; expand only when routing actually fails.
    routeBufferM: 180,
    neighborRing: 0,
    maxTilesPerRequest: 96,
    // dev27: prefer prebuilt nationwide HGR1 graph tiles; Overpass remains a fallback.
    preferGraphRouting: true,
    // dev30: prefer 0.0125° pre-refined HGR2 microtiles when the HF manifest exposes graph2.
    preferHgr2: true,
    fallbackToOverpass: true,
    graphRouteBufferM: 220,
    graphNeighborRing: 0,
    graphLoadStages: [
      { marginM: 220, ring: 0 },
      { marginM: 520, ring: 0 },
      // dev34.5: expand the core bbox before adding a one-tile moat.
      // This avoids making a peripheral ring tile a hard dependency for the first 850 m probe.
      { marginM: 850, ring: 0 },
      { marginM: 850, ring: 1 }
    ],
    maxGraphTilesPerRequest: 96,
    attachToMultisource: true,
    autoPrefetchForAB: true,
    deferEvidenceUntilRouteReady: true,
    cacheTiles: true
  },
  multisource: {
    enabled: true,
    evidenceIndexUrl: "./data/multisource/evidence-index.json",
    sourceMetadataUrl: "./data/multisource/source-metadata.json",
    productionMutationEnabled: false,
    autoLoad: false
  },
  officialEvidenceDiscovery: {
    enabled: true,
    // dev33: route-local automatic official-evidence discovery. Only source-following
    // official pedestrian geometry can become a detached fusion witness.
    sourceKeys: ["nlma-sidewalk", "nlma-bikeway"],
    routeCorridorM: 220,
    sampleSpacingM: 4,
    graphCoverageM: 7,
    sourceAttachMaxM: 18,
    minWitnessM: 6,
    maxWitnessM: 90,
    equivalentGraphRatio: 1.35,
    equivalentGraphSlackM: 12,
    minGraphDetourRatio: 1.5,
    minGraphDetourM: 12,
    maxAnchorHeadingDiffDeg: 65,
    graphProbeMaxM: 260,
    clusterRadiusM: 15,
    maxFeatureCount: 220,
    maxCandidates: 12,
    allowKnownGapFallback: true,
    productionMutationEnabled: false
  },
  nationwideRegression: {
    enabled: true,
    // dev34: developer-only nationwide topology/evidence/fusion regression matrix.
    // Never runs during normal A→B; explicitly triggered from diagnostics.
    routeMarginM: 260,
    evidenceMarginM: 220,
    graphRing: 0,
    evidenceRing: 0,
    maxGraphTiles: 48,
    maxEvidenceTiles: 32,
    snapToleranceM: 140,
    requestTimeoutMs: 18000
  },
  multisourceFusion: {
    enabled: true,
    sourceAttachMaxM: 18,
    endpointReuseM: 0.8,
    renderOnMap: true,
    productionMutationEnabled: false
  },
  graphRouting: {
    enabled: true,
    overpassEndpoints: [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter"
    ],
    overpassTimeoutMs: 22000,
    bboxMarginM: 420,
    maxBboxSideM: 2800,
    snapMaxM: 120,
    // dev34.5: only when the globally-nearest A/B edges belong to different
    // disconnected components, choose the nearest component reachable from both
    // endpoints within snapMaxM.  Normal connected snaps are unchanged.
    connectivitySnapFallbackEnabled: true,
    snapEndpointToleranceM: 1.5,
    pedestrianSnapSlackM: 12,
    manualReplayCorridorM: 16,
    manualReplayMaxCorridorM: 36,
    manualReplayBacktrackToleranceM: 12,
    manualReplayProgressBucketM: 10,
    manualReplayGoalToleranceM: 28,
    manualReplayMinCoverage: 0.88,
    manualReplayFidelityThresholdM: 14,
    manualReplayDivergenceSampleM: 6,
    topologyBreakpointProbeM: 14,
    topologyBreakpointMaxCandidates: 8,
    endpointCounterfactualRadiusM: 24,
    endpointCounterfactualMaxCandidates: 8,
    corridorTraceSampleSpacingM: 8,
    corridorTraceMaxComponents: 16,
    corridorTraceTransitionWindowM: 90,
    corridorTraceConnectorMaxGapM: 90,
    rawJunctionNearRadiusM: 45,
    rawJunctionEndpointGapMaxM: 20,
    rawJunctionTouchMaxM: 2.5,
    manualReplayLateralWeight: 4,
    maxFineNodes: 12000,
    maxExpandedStates: 12000,
    maxShadeEdgeEvaluations: 1400,
    timeBucketSec: 30,
    shadeTimeBucketSec: 60,
    maxFineEdgeM: 85,
    pathMaxFineEdgeM: 55,
    maxLabelsPerState: 5, // legacy/ignored by dev7; kept only for config compatibility
    shadeSampleSpacingM: 18,
    shadeMaxSamplesPerEdge: 5,
    shadeReconcileSampleSpacingM: 10,
    shadeReconcileMismatchSec: 45,
    shadeReconcileTopEdges: 8,
    sourceGapCounterfactualEnabled: true,
    sourceGapCounterfactualMaxGapM: 55,
    sourceGapCounterfactualStrictM: 14,
    // dev20.1: do not block the first validation pass on the expensive patched
    // ShadeMap + global min-sun causal rerun. It remains available by button.
    deferSourceGapCounterfactual: true,
    // dev20: never auto-promote a hand-drawn source gap into production.
    // These thresholds only classify what needs manual review.
    safeConnectorNearTouchM: 2.5,
    safeConnectorReviewGapM: 12,
    matureEngineCrossCheckEnabled: true,
    matureEngineTimeoutMs: 15000,
    matureEngineShapeMaxPoints: 180,
    valhallaBenchmarkEndpoint: "https://valhalla1.openstreetmap.de",
    valhallaClientId: "haidian-route-exposure-research",
    valhallaMinIntervalMs: 1100, // FOSSGIS public demo: keep at <= 1 request/sec
    graphHopperBenchmarkEndpoint: "https://graphhopper.com/api/1",
    graphHopperApiKey: "", // optional; leave blank to run Valhalla only
    diagnosticMatchThresholdM: 16,
    diagnosticSampleSpacingM: 18,
    shadeConcurrency: 2,
    // dev32: prewarm a deterministic edge/time table on the already-pruned local graph.
    // Search then performs Map lookups instead of serially waiting for ShadeMap at each label expansion.
    temporalShadeTableEnabled: true,
    temporalShadeTableConcurrency: 8,
    temporalShadeTableMaxBucketsPerEdge: 8,
    temporalShadeTableMaxEvaluations: 1800,
    // dev32 correctness gates. Exact replay checks the temporal winner at true
    // traversal timestamps; full temporal-vs-on-demand A/B audit remains opt-in.
    candidateCorrectnessExactReplayEnabled: true,
    candidateCorrectnessExactReplayToleranceSec: 45,
    candidateCorrectnessAuditEnabled: true,
    // Maximum number of independent outgoing edge shade costs in flight for fallback misses.
    shadeEdgeBatchConcurrency: 4,
    cooperativeYieldMs: 12,
    yieldEveryExpanded: 8,
    yieldEveryDijkstra: 180,
    externalGraphDetourPrune: true,
    externalGraphPruneSlackSec: 3
  }
};
