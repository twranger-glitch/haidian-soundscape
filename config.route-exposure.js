/* Haidian Soundscape — Route Exposure configuration v9.0.0-dev27 */
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
  // v9.0.0-dev27: mature-engine geometry overlay + isolated experimental multi-source fusion; preserves dev13–dev20.1 diagnostics, keeps all source-gap
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
    routeBufferM: 650,
    neighborRing: 1,
    maxTilesPerRequest: 96,
    // dev27: prefer prebuilt nationwide HGR1 graph tiles; Overpass remains a fallback.
    preferGraphRouting: true,
    fallbackToOverpass: true,
    graphRouteBufferM: 850,
    graphNeighborRing: 1,
    maxGraphTilesPerRequest: 96,
    attachToMultisource: true,
    autoPrefetchForAB: true,
    cacheTiles: true
  },
  multisource: {
    enabled: true,
    evidenceIndexUrl: "./data/multisource/evidence-index.json",
    sourceMetadataUrl: "./data/multisource/source-metadata.json",
    productionMutationEnabled: false,
    autoLoad: false
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
    cooperativeYieldMs: 12,
    yieldEveryExpanded: 8,
    yieldEveryDijkstra: 180
  }
};
