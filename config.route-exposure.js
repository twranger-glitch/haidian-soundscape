/* Haidian Soundscape — Route Exposure configuration v9.0.0-dev3 */
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
  // dev6: reject only true loop-return / reverse repeated-corridor waste; normal street detours remain allowed.
  routeQualityEnabled: true,
  routeQualitySampleM: 8,
  routeQualityLoopReturnRadiusM: 5,
  routeQualityMinLoopExcursionM: 70,
  routeQualityRepeatedCorridorRadiusM: 5,
  routeQualityRepeatedCorridorMinSeparationM: 40,
  routeQualityMaxRepeatedCorridorM: 32,
  routeQualityOppositeHeadingDeg: 155,
  // v9.0.0-dev3: local OSM graph + interactive diagnostics / manual-route graph matching.
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
    maxExpandedStates: 5000,
    maxShadeEdgeEvaluations: 700,
    timeBucketSec: 60,
    shadeTimeBucketSec: 120,
    shadeSampleSpacingM: 30,
    shadeMaxSamplesPerEdge: 8,
    diagnosticMatchThresholdM: 16,
    diagnosticSampleSpacingM: 18,
    shadeConcurrency: 3
  }
};
