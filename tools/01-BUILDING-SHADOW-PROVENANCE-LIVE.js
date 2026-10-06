/* ASTRA building-shadow provenance diagnostic, baseline dev37.9.9.16.18.
 * One paste. No model replacement, monkey-patching, automatic query or proof authority.
 * Browser: ASTRABuildingShadowDiagnostic.help(); CommonJS: createDiagnostic(host).
 */
(function (factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else {
    const name = 'ASTRABuildingShadowDiagnostic';
    if (Object.prototype.hasOwnProperty.call(window, name)) {
      console.info('[ASTRA building diagnostic] Already installed; reuse the existing handle.');
      return;
    }
    Object.defineProperty(window, name, { value: factory(window), configurable: true });
    console.info('[ASTRA building diagnostic] Installed, query-free. Run ASTRABuildingShadowDiagnostic.help().');
  }
})(function createDiagnostic(host) {
  'use strict';
  const LIMITS = Object.freeze({ reports: 12, casters: 2048, rawNodes: 24000, rawDepth: 18,
    stringChars: 16000, totalCharacters: 8000000, sourceBytes: 2000000, sourceFiles: 8,
    geometryCoordinates: 120000, diagnosticQueryMs: 10000 });
  const reports = [], ids = new WeakMap();
  let nextId = 1, usedCharacters = 0, droppedReports = 0, active = null, clickState = null;
  let mapBinding = null, observer = null;
  const own = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k);
  const iso = value => {
    if (value === null || value === undefined || value === '') return null;
    const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  };
  const point = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 ? { lat: p.lat, lng: p.lng } : null;
  const samePoint = (a, b) => !!point(a) && !!point(b) && a.lat === b.lat && a.lng === b.lng;
  const objectId = o => {
    if (!o || typeof o !== 'object') return null;
    if (!ids.has(o)) ids.set(o, 'runtime-object-' + nextId++);
    return ids.get(o);
  };
  // Do not execute arbitrary getters while inspecting a source/engine object.
  const data = (o, k) => {
    try { const d = Object.getOwnPropertyDescriptor(o, k); return d && own(d, 'value') ? d.value : undefined; }
    catch (_) { return undefined; }
  };
  const method = (o, k) => typeof data(o, k) === 'function' ? data(o, k) : null;
  function raw(value, budget = { nodes: LIMITS.rawNodes, characters: 2000000 }) {
    const seen = new WeakSet(), omissions = []; let nodes = 0;
    function copy(v, depth, path) {
      if (++nodes > LIMITS.rawNodes || --budget.nodes < 0 || depth > LIMITS.rawDepth) {
        if (omissions.length < 24) omissions.push(path + ':limit');
        return { diagnosticOmitted: 'node-or-depth-limit' };
      }
      if (v === undefined) return { diagnosticUnobserved: true };
      if (v === null || typeof v === 'boolean' || typeof v === 'number') return v;
      if (typeof v === 'string') {
        if (budget.characters < Math.min(v.length, LIMITS.stringChars)) {
          if (omissions.length < 24) omissions.push(path + ':character-limit');
          return { diagnosticOmitted: 'character-limit' };
        }
        budget.characters -= Math.min(v.length, LIMITS.stringChars);
        if (v.length > LIMITS.stringChars) { omissions.push(path + ':string-limit'); return v.slice(0, LIMITS.stringChars); }
        return v;
      }
      if (typeof v === 'function') return { diagnosticFunction: v.name || '(anonymous)' };
      if (typeof v !== 'object') return String(v);
      if (Object.prototype.toString.call(v) === '[object Date]') return iso(v);
      if (seen.has(v)) return { diagnosticReference: objectId(v) };
      seen.add(v);
      if (Array.isArray(v)) return v.slice(0, LIMITS.rawNodes).map((x, i) => copy(x, depth + 1, path + '[' + i + ']'));
      const out = Object.create(null);
      for (const k of Object.keys(v).slice(0, LIMITS.rawNodes)) {
        const d = Object.getOwnPropertyDescriptor(v, k);
        out[k] = d && own(d, 'value') ? copy(d.value, depth + 1, path + '.' + k) : { diagnosticUnobserved: 'accessor' };
        if (nodes > LIMITS.rawNodes) break;
      }
      return out;
    }
    return { value: copy(value, 0, '$'), omissions, complete: omissions.length === 0 };
  }
  function identity(snapshot) {
    return snapshot ? { objectId: objectId(snapshot), cacheKey: data(snapshot, 'cacheKey') ?? null,
      release: data(snapshot, 'release') ?? null, state: data(snapshot, 'state') ?? null } : null;
  }
  function readVisual() {
    const shade = data(host, 'HaidianShade'), getter = method(shade, 'getVisualDiagnostics');
    if (!getter) return { observed: false, reason: 'getVisualDiagnostics-unavailable', raw: null };
    try { const v = getter.call(shade); return { observed: true, raw: raw(v), identity: {
      frameId: data(v, 'frameId') ?? data(v, 'committedFrameId') ?? null,
      epoch: data(v, 'epoch') ?? data(v, 'committedEpoch') ?? null,
      date: iso(data(v, 'date')), sunId: data(v, 'sunId') ?? null,
      snapshotObjectId: objectId(data(v, 'buildingSnapshot') ?? data(v, 'snapshot')) } }; }
    catch (e) { return { observed: false, reason: String(e.message || e), raw: null }; }
  }
  function readRouteDiagnostics() {
    const shade = data(host, 'HaidianShade'), getter = method(shade, 'getRouteDiagnostics');
    if (!getter) return { observed: false, reason: 'getRouteDiagnostics-unavailable' };
    try { return { observed: true, raw: raw(getter.call(shade)) }; }
    catch (e) { return { observed: false, reason: String(e.message || e) }; }
  }
  function publicAPISources() {
    const shade = data(host, 'HaidianShade'), out = {};
    for (const name of ['prepareRouteModel', 'analyzeShadeModelAt', 'getVisualDiagnostics', 'getRouteDiagnostics', 'getRouteShadeCacheContext']) {
      const fn = method(shade, name);
      if (fn) out[name] = Function.prototype.toString.call(fn).slice(0, LIMITS.stringChars);
    }
    return { functions: out, provenance: 'actual-public-function-toString-not-complete-module-or-private-closure' };
  }
  function card() {
    const nodes = host.document?.querySelectorAll?.('.leaflet-popup-content') || [];
    return Array.from(nodes).slice(0, 4).map(n => String(n.textContent || '').slice(0, LIMITS.stringChars));
  }
  function inventory() {
    const apis = [];
    for (const name of Object.getOwnPropertyNames(host)) {
      if (!/^(?:Haidian.*(?:Shade|Building)|ASTRA.*(?:Shade|Building)|OwnShade|NLSC)/i.test(name) || name === 'ASTRABuildingShadowDiagnostic') continue;
      const value = data(host, name); if (!value || typeof value !== 'object') continue;
      const keys = Object.getOwnPropertyNames(value).slice(0, 256);
      apis.push({ name, keys, functions: keys.filter(k => method(value, k)) });
    }
    const scripts = Array.from(host.document?.querySelectorAll?.('script[src]') || []).map(s => s.src).filter(Boolean);
    return { scripts, apis, expectedBaseline: { graphCore: '37.9.9.16.18', routeCore: '37.9.9.16.10' },
      warnings: ['Script URL/version is not executed-byte authentication.', 'Private closure stages are not observable merely because a public API exists.'] };
  }
  function geometryStatus(geometry) {
    if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return 'unavailable-or-not-polygon';
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    if (!Array.isArray(polygons) || !polygons.length) return 'invalid-or-empty';
    for (const polygon of polygons) {
      if (!Array.isArray(polygon) || !polygon.length) return 'invalid-rings';
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 4 || ring.some(p => !Array.isArray(p) || p.length < 2 || !p.slice(0, 2).every(Number.isFinite))) return 'invalid-coordinates';
        if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) return 'unclosed-ring';
      }
    }
    return 'structurally-valid-only-not-a-topology-proof';
  }
  function receiverDistance(geometry, receiver) {
    // Inspection only; never a terminal, admission, shadow, access or proof gate.
    if (!point(receiver) || geometryStatus(geometry) !== 'structurally-valid-only-not-a-topology-proof') return null;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    const scale = Math.PI / 180 * 6371008.8, cos = Math.cos(receiver.lat * Math.PI / 180);
    let minimum = Infinity, contained = false;
    for (const polygon of polygons) {
      const ringInside = [];
      for (const ring of polygon) {
        const xy = ring.map(p => [(((p[0] - receiver.lng + 540) % 360) - 180) * scale * cos, (p[1] - receiver.lat) * scale]);
        if (xy.some(p => Math.hypot(...p) > 20000)) return null;
        let inside = false;
        for (let i = 1; i < xy.length; i++) {
          const a = xy[i - 1], b = xy[i], dx = b[0] - a[0], dy = b[1] - a[1];
          const denominator = dx * dx + dy * dy;
          const t = denominator ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / denominator)) : 0;
          minimum = Math.min(minimum, Math.hypot(a[0] + t * dx, a[1] + t * dy));
          if ((a[1] > 0) !== (b[1] > 0) && 0 < a[0] + dx * (-a[1]) / dy) inside = !inside;
        }
        ringInside.push(inside);
      }
      contained ||= ringInside[0] && !ringInside.slice(1).some(Boolean);
    }
    return { distanceM: contained ? 0 : minimum, containsReceiverForInspection: contained,
      semantics: 'local-planar-footprint-inspection-only; <=20km extent; not shadow/admission/terminal evidence' };
  }
  function casters(snapshot, budget, receiver) {
    const features = data(snapshot, 'features');
    if (!Array.isArray(features)) return { observed: false, complete: false, items: [], reason: 'snapshot.features-unavailable' };
    let coordinates = 0, geometryCapped = false;
    const items = features.slice(0, LIMITS.casters).map((f, index) => {
      const p = data(f, 'properties') || {}, g = data(f, 'geometry');
      const height = data(p, 'height') ?? null;
      const stack = [{ value: data(g, 'coordinates'), depth: 0 }], seen = new WeakSet();
      let visited = 0, malformedOrCapped = false;
      while (stack.length && coordinates <= LIMITS.geometryCoordinates && !malformedOrCapped) {
        const { value: v, depth } = stack.pop();
        if (++visited > LIMITS.rawNodes || depth > LIMITS.rawDepth) { malformedOrCapped = true; break; }
        if (!Array.isArray(v)) continue;
        if (seen.has(v)) { malformedOrCapped = true; break; } seen.add(v);
        if (v.length >= 2 && typeof v[0] === 'number') { coordinates++; continue; }
        if (v.length > LIMITS.rawNodes) { malformedOrCapped = true; break; }
        for (const child of v) stack.push({ value: child, depth: depth + 1 });
      }
      const omitted = coordinates > LIMITS.geometryCoordinates || malformedOrCapped;
      geometryCapped ||= omitted;
      const distance = omitted ? null : receiverDistance(g, receiver);
      return { index, id: data(f, 'id') ?? data(p, 'id') ?? null,
        source: data(p, 'source') ?? data(f, 'source') ?? null,
        geometry: omitted ? { complete: false, value: { diagnosticOmitted: 'session-geometry-coordinate-cap' } } : raw(g, budget),
        geometryValidity: omitted ? 'unobserved-coordinate-cap' : geometryStatus(g), properties: raw(p, budget),
        height: { rawValue: height, provenance: data(p, 'height_source') ?? data(p, 'heightSource') ?? null,
          confidence: data(p, 'height_confidence') ?? data(p, 'heightConfidence') ?? null,
          evidenceClass: 'unclassified-source-properties',
          note: 'A numeric height or a height-source label alone is not verified reported-height evidence; no fallback height is created.' },
        receiverDistanceM: distance?.distanceM ?? null, footprintInspection: distance,
        admission: null, filteredOrDedupedReason: null, shadowGenerated: null, receiverHit: null };
    });
    return { observed: true, complete: features.length <= LIMITS.casters && !geometryCapped && items.every(i => i.geometry.complete && i.properties.complete), originalCount: features.length, items,
      note: 'Snapshot features, not a claim that all were considered/admitted by the shadow model. Distance is independent local-planar footprint inspection; private index decisions remain unobserved.' };
  }
  function compareVisual(before, after, requestedAt, snapshot) {
    const b = before?.identity || {}, a = after?.identity || {};
    const compare = (x, y) => x == null || y == null ? 'unobserved' : x === y ? 'same' : 'different';
    return { frameBeforeAfter: compare(b.frameId, a.frameId), epochBeforeAfter: compare(b.epoch, a.epoch),
      sunBeforeAfter: compare(b.sunId, a.sunId), visualTimeBeforeAfter: compare(b.date, a.date),
      requestedVsVisualTime: compare(iso(requestedAt), b.date),
      requestedSnapshotVsVisual: compare(objectId(snapshot), b.snapshotObjectId),
      sameBuildingSet: 'unobserved', pointCardSnapshot: 'unobserved',
      note: 'Equal cache keys/timestamps, or a nearby footprint, do not prove committed frame/source-set identity.' };
  }
  // Optional stage evidence is a diagnostic assertion, never authority for the app.
  // Require receiver/time/frame/snapshot/sun/caster identity on BOTH hit and classifier.
  function stageAudit(e) {
    const codes = [], gaps = [], source = e?.sourceCoverage || {}, list = e?.casters;
    const shadow = e?.shadow || {}, classifier = e?.classifier || {}, visual = e?.visual || {};
    if (source.loaded === false) codes.push('BUILDING_SOURCE_NOT_LOADED');
    if (source.loaded === true && source.candidateEnumerationComplete === true && source.footprintCount === 0) codes.push('NO_BUILDING_FOOTPRINT_SOURCE');
    for (const c of Array.isArray(list) ? list : []) {
      if (c.filtered === true || c.deduped === true) codes.push('BUILDING_FILTERED_OR_DEDUPED');
      if (c.heightStatus === 'missing') codes.push('BUILDING_HEIGHT_MISSING');
      if (c.admitted === false) codes.push('BUILDING_NOT_ADMITTED_TO_SHADOW_MODEL');
      if (c.admitted === true && c.shadowGenerated === false) codes.push('BUILDING_SHADOW_NOT_GENERATED');
    }
    if (shadow.generated === true && shadow.receiverHit === false) codes.push('BUILDING_SHADOW_GEOMETRY_MISS');
    if (e?.error) codes.push('MODEL_ERROR_OR_TIMEOUT');
    const required = ['frameId', 'epoch', 'snapshotObjectId', 'sunId', 'casterId'];
    const bound = required.every(k => shadow[k] != null && classifier[k] != null && shadow[k] === classifier[k]) &&
      samePoint(shadow.point, classifier.point) && iso(shadow.at) !== null && iso(shadow.at) === iso(classifier.at);
    if (!bound) gaps.push('Positive hit/classifier identity is not completely bound.');
    const mismatched = required.some(k => shadow[k] != null && classifier[k] != null && shadow[k] !== classifier[k]) ||
      (point(shadow.point) && point(classifier.point) && !samePoint(shadow.point, classifier.point)) ||
      (iso(shadow.at) && iso(classifier.at) && iso(shadow.at) !== iso(classifier.at));
    if (mismatched) codes.push('FRAME_OR_EPOCH_MISMATCH');
    const captureBound = !e?.receiverContext || (samePoint(shadow.point, e.receiverContext.point) &&
      iso(shadow.at) !== null && iso(shadow.at) === iso(e.receiverContext.at));
    if (!captureBound) gaps.push('Stage assertion belongs to a different captured receiver/time.');
    const positive = shadow.generated === true && shadow.receiverHit === true && shadow.confirmed === true &&
      shadow.evidenceClass === 'reported' && shadow.geometryValid === true && bound && captureBound;
    if (positive) codes.push('BUILDING_SHADOW_HIT_CONFIRMED');
    const finalConsistent = !e?.finalModelContext || classifier.finalState === e.finalModelContext.state;
    if (!finalConsistent) gaps.push('Stage classifier assertion differs from the captured model result.');
    const discrepancy = positive && classifier.buildingState === 'unknown' && classifier.finalState === 'unknown' && finalConsistent;
    if (discrepancy) codes.push('BUILDING_SHADOW_HIT_BUT_CLASSIFIER_UNKNOWN');
    const visualBound = positive && visual.generated === true && required.every(k => visual[k] != null && visual[k] === shadow[k]) &&
      iso(visual.at) === iso(shadow.at) && samePoint(visual.point, shadow.point);
    if (!visualBound) gaps.push('Visible shadow is not completely bound to the same positive hit/receiver.');
    return { codes: [...new Set(codes)], boundPositiveHit: positive, layer3AssertionsConsistent: discrepancy && visualBound,
      origin: e?.origin || 'unobserved', authority: 'diagnostic-assertions-only-not-production-proof',
      completeProductionTrace: false, gaps,
      note: 'No cryptographic/private-engine authentication exists here. Caller/fixture assertions do not prove a production defect or change unknown.' };
  }
  function buildReport(input) {
    const snapshot = input.snapshot, model = input.model, reasons = Array.isArray(data(model, 'unknownReasons')) ? data(model, 'unknownReasons').slice() : [];
    const budget = { nodes: LIMITS.rawNodes, characters: 2000000 };
    const rawModel = raw(model, budget), rawSnapshot = raw(snapshot, budget), rawStages = raw(input.stageEvidence, budget);
    const candidates = casters(snapshot, budget, input.point), consistency = compareVisual(input.visualBefore, input.visualAfter, input.at, snapshot);
    const stages = stageAudit(input.stageEvidence ? Object.assign({}, input.stageEvidence,
      { receiverContext: { point: input.point, at: input.at }, finalModelContext: { state: data(model, 'state') } }) : null), codes = stages.codes.slice();
    if (input.error) codes.push('MODEL_ERROR_OR_TIMEOUT');
    if (reasons.includes('building-height-unknown')) codes.push('BUILDING_HEIGHT_MISSING');
    if (candidates.observed && candidates.complete && candidates.originalCount === 0) codes.push('NO_BUILDING_FOOTPRINT_SOURCE');
    if (Object.entries(consistency).some(([k, v]) => !['note', 'requestedVsVisualTime'].includes(k) && v === 'different')) codes.push('FRAME_OR_EPOCH_MISMATCH');
    if (consistency.requestedVsVisualTime === 'different') codes.push('VISUAL_AND_REQUESTED_TIME_DIFFER');
    const report = { schema: 'astra-building-shadow-provenance-diagnostic-v1', diagnosticOnly: true,
      productionLiveAcceptance: false, productionFixProven: false, capturedAt: new Date().toISOString(),
      kind: input.kind || 'supplied-record', point: point(input.point), requestedTime: iso(input.at),
      modelInputSnapshot: identity(snapshot), solarGeometry: { observed: data(model, 'sun') != null, raw: raw(data(model, 'sun')),
        semantics: 'raw-return-only; angle units/solar/frame identity unproven unless explicitly recorded' },
      sourceCoverage: { stats: raw(data(snapshot, 'stats')), snapshotState: data(snapshot, 'state') ?? null,
        osm: null, overture: null, nlsc: null, tileCompleteness: null, realWorldCompleteness: 'unproven' },
      casters: candidates, shadowModel: { admitted: null, generated: null, receiverHit: null, reason: 'private-engine-stage-unobserved' },
      classifier: { state: data(model, 'state') ?? null, shaded: data(model, 'shaded') ?? null,
        confirmed: data(model, 'confirmed') ?? null, sourceType: data(model, 'sourceType') ?? null,
        unknownReasons: reasons, building: raw(data(model, 'building')), canopy: raw(data(model, 'canopy')), terrain: raw(data(model, 'terrain')) },
      rawModel, rawSnapshot, visualBefore: input.visualBefore ?? null, visualAfter: input.visualAfter ?? null,
      pointCard: { rawText: input.card ?? [], provenance: 'observed-DOM-text-only-not-a-model-record', snapshotIdentity: null },
      visualConsistency: consistency, stageAssertions: rawStages, stageAudit: stages,
      reasonCodes: [...new Set(codes)], error: input.error || null,
      routeReference: input.routeReference || null, inventory: input.inventory || null,
      clickObservation: input.clickObservation ? raw(input.clickObservation) : null,
      routeEngineDiagnosticsBefore: input.routeDiagnosticsBefore || null,
      routeEngineDiagnosticsAfter: input.routeDiagnosticsAfter || null,
      publicAPISources: input.publicAPISources || null,
      unresolved: ['Current package omits building-data-provider.js, building-sources.js, own-shade-renderer.js and shademap-integration.js.',
        'Private committed-frame caster set, spatial-query/filter decisions, projection/ray and point-card classifier require source/native instrumentation.',
        'No visual pixel, footprint containment, estimate or missing NLSC record is used as shade/sun evidence.'] };
    report.serializationComplete = [rawModel, rawSnapshot, rawStages].every(r => r.complete) && candidates.complete;
    return report;
  }
  function save(report) {
    const serialized = JSON.stringify(report), size = serialized.length;
    if (reports.length >= LIMITS.reports || usedCharacters + size > LIMITS.totalCharacters) {
      droppedReports++; throw new Error('DIAGNOSTIC_STORAGE_CAP: export/clear captured reports; production caps unchanged');
    }
    usedCharacters += size; reports.push(serialized); return report;
  }
  function captureRecord(input) { return save(buildReport(input)); }
  function selectedRouteSample({ candidateId, index = 0 } = {}) {
    const route = data(host, 'HaidianRouteExposure');
    // The following public getters are explicitly exported by the supplied route core.
    let analysis = null, candidate = null;
    if (candidateId) { candidate = route?.lastCandidates?.find(c => c.id === candidateId); analysis = candidate?.analysis; }
    else { candidate = route?.lastSelectedCandidate; analysis = candidate?.analysis || route?.lastAnalysis; }
    if (!analysis || !Number.isInteger(index) || index < 0 || !analysis.segments?.[index]) throw new Error('NO_CAPTURED_ROUTE_SAMPLE');
    const row = analysis.segments[index];
    return { kind: 'existing-route-sample-no-reevaluation', point: row.segment.sample, at: row.at, model: row.model,
      visualBefore: readVisual(), visualAfter: readVisual(), card: card(), inventory: inventory(),
      routeDiagnosticsBefore: readRouteDiagnostics(), publicAPISources: publicAPISources(),
      routeReference: { candidateId: candidate?.id ?? null, index, segment: raw(row.segment),
        departure: analysis.departure, snapshotSummary: raw(analysis.buildingSnapshot),
        fullSnapshotAvailable: false, warning: 'Route export retains only key/release/state/stats, not the exact prepared snapshot object.' } };
  }
  function captureRouteSample(options) { return captureRecord(selectedRouteSample(options)); }
  function routeBusy() {
    const route = data(host, 'HaidianRouteExposure'), internals = data(route, '_internals'), getter = method(internals, 'getEndpointNormalizationState');
    return getter ? getter.call(internals)?.busy === true : false;
  }
  async function probe({ point: receiver, at, signal, stageEvidence, clickObservation } = {}) {
    const p = point(receiver), time = iso(at);
    if (!p || !time) throw new Error('EXPLICIT_VALID_POINT_AND_TIME_REQUIRED');
    if (active) throw new Error('DIAGNOSTIC_QUERY_ALREADY_ACTIVE');
    if (routeBusy()) throw new Error('NORMAL_ROUTE_ANALYSIS_ACTIVE_NO_DIAGNOSTIC_QUERY');
    const shade = data(host, 'HaidianShade'), prepare = method(shade, 'prepareRouteModel'), analyze = method(shade, 'analyzeShadeModelAt');
    if (!prepare || !analyze) throw new Error('REQUIRED_BASELINE_SHADE_APIS_UNAVAILABLE');
    const controller = new host.AbortController(), visualBefore = readVisual(), routeDiagnosticsBefore = readRouteDiagnostics();
    active = controller;
    let prepared = null, model = null, error = null, timer = null, rejectDeadline;
    const externalAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener?.('abort', externalAbort, { once: true });
    const deadline = new Promise((_, reject) => { rejectDeadline = reject;
      timer = host.setTimeout(() => { reject(new Error('DIAGNOSTIC_QUERY_TIMEOUT')); controller.abort(); }, LIMITS.diagnosticQueryMs); });
    const work = (async () => {
      if (controller.signal.aborted) throw new Error('DIAGNOSTIC_QUERY_ABORTED');
      prepared = await prepare.call(shade, { points: [p], date: new Date(time), purpose: 'route', signal: controller.signal });
      if (controller.signal.aborted) throw new Error('DIAGNOSTIC_QUERY_ABORTED');
      const snapshot = data(prepared, 'snapshot');
      // Never omit buildingSnapshot and silently classify using a different global cache.
      if (!snapshot) throw new Error('PREPARED_SNAPSHOT_UNAVAILABLE_NO_FALLBACK');
      if (routeBusy()) { controller.abort(); throw new Error('NORMAL_ROUTE_ANALYSIS_STARTED_DIAGNOSTIC_ABORTED'); }
      const result = await analyze.call(shade, p.lat, p.lng, new Date(time), { buildingSnapshot: snapshot, signal: controller.signal });
      if (controller.signal.aborted) throw new Error('DIAGNOSTIC_QUERY_ABORTED');
      return result;
    })();
    // Even an uncooperative provider may ignore abort. Do not start another
    // request until the underlying work has actually settled.
    work.then(() => { if (active === controller) active = null; }, () => { if (active === controller) active = null; });
    const abortDeadline = () => rejectDeadline(new Error('DIAGNOSTIC_QUERY_ABORTED'));
    controller.signal.addEventListener('abort', abortDeadline, { once: true });
    try { model = await Promise.race([work, deadline]); }
    catch (e) { error = { name: e.name || 'Error', message: String(e.message || e) }; }
    finally { host.clearTimeout(timer); signal?.removeEventListener?.('abort', externalAbort);
      controller.signal.removeEventListener('abort', abortDeadline); }
    return captureRecord({ kind: 'explicit-diagnostic-query-route-api-not-point-card', point: p, at: time,
      snapshot: data(prepared, 'snapshot'), model, error, visualBefore, visualAfter: readVisual(),
      card: card(), inventory: inventory(), stageEvidence, clickObservation,
      routeDiagnosticsBefore, routeDiagnosticsAfter: readRouteDiagnostics(), publicAPISources: publicAPISources() });
  }
  function watchClicks() {
    if (mapBinding) return true;
    const map = data(host, 'map');
    if (!map?.on || !map?.off) throw new Error('LEAFLET_MAP_NOT_EXPOSED_USE_EXPLICIT_PROBE');
    const handler = event => {
      const visual = readVisual(), shade = data(host, 'HaidianShade');
      clickState = { point: point(event.latlng), at: visual.identity?.date || iso(data(data(shade, 'state'), 'date')),
        observedAt: new Date().toISOString(), visualAtClick: visual, cardText: card(),
        warning: 'Click observation, not the private point-card invocation/result. probeLastClick is a separate route-API query.' };
    };
    map.on('click', handler); mapBinding = { map, handler };
    if (host.MutationObserver && host.document?.body) {
      observer = new host.MutationObserver(() => { if (clickState) clickState.cardText = card(); });
      observer.observe(host.document.body, { childList: true, subtree: true, characterData: true });
    }
    return true;
  }
  function stop() {
    if (mapBinding) { mapBinding.map.off('click', mapBinding.handler); mapBinding = null; }
    observer?.disconnect(); observer = null; active?.abort();
  }
  async function probeLastClick() {
    if (!clickState?.point || !clickState.at) throw new Error('NO_CLICK_WITH_EXACT_TIME_USE_EXPLICIT_PROBE');
    return probe({ point: clickState.point, at: clickState.at, clickObservation: clickState });
  }
  function dump() {
    return { schema: 'astra-building-shadow-diagnostic-session-v1', diagnosticOnly: true,
      limits: LIMITS, reports: reports.map(r => JSON.parse(r)), droppedReports, storedCharacters: usedCharacters,
      lastClick: clickState ? raw(clickState) : null, inventory: inventory(), productionFunctionsReplaced: false,
      productionGraphDirectlyMutated: false, diagnosticQueryMayLoadSourcesAndUpdateModelCounters: true,
      productionProofOrWinnerAuthority: false, productionProofAcceptanceExecuted: false,
      executionContext: { href: host.location?.href ?? null, origin: host.location?.origin ?? null,
        note: 'Origin records where this diagnostic ran; it does not prove public-site acceptance or source/frame authentication.' } };
  }
  function download() {
    const text = JSON.stringify(dump(), null, 2), blob = new host.Blob([text], { type: 'application/json' });
    const url = host.URL.createObjectURL(blob), a = host.document.createElement('a');
    a.href = url; a.download = 'ASTRA-BUILDING-SHADOW-TRACE-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    a.click(); host.setTimeout(() => host.URL.revokeObjectURL(url), 0); return a.download;
  }
  // Opt-in source export. Re-fetched bytes MUST NOT be presented as executed bytes.
  async function exportLoadedBuildingSources() {
    if (active) throw new Error('STOP_DIAGNOSTIC_QUERY_BEFORE_SOURCE_EXPORT');
    const wanted = /\/(?:building-data-provider|building-sources|own-shade-renderer|shademap-integration|nlsc-official-height|nlsc-official-geometry)\.js(?:\?|$)/;
    const urls = [...new Set(inventory().scripts.filter(u => wanted.test(u)))].slice(0, LIMITS.sourceFiles), records = [];
    for (const url of urls) {
      const record = { url, provenance: 're-fetched-current-script-URL-not-executed-byte-authentication', text: null, error: null };
      const controller = new host.AbortController(), timer = host.setTimeout(() => controller.abort(), LIMITS.diagnosticQueryMs);
      try {
        if (new host.URL(url, host.location.href).origin !== host.location.origin) throw new Error('SAME_ORIGIN_SOURCES_ONLY');
        const response = await host.fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('HTTP_' + response.status);
        if (!response.body?.getReader) throw new Error('STREAM_READER_REQUIRED_FOR_BOUNDED_EXPORT');
        const reader = response.body.getReader(), chunks = []; let bytes = 0;
        try {
          for (;;) { const { done, value } = await reader.read(); if (done) break;
            bytes += value.byteLength; if (bytes > LIMITS.sourceBytes) { controller.abort(); throw new Error('SOURCE_BYTE_CAP'); } chunks.push(value); }
        } finally { try { await reader.cancel(); } catch (_) {} }
        const joined = new Uint8Array(bytes); let offset = 0;
        for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
        record.text = new host.TextDecoder().decode(joined); record.bytes = bytes;
        if (host.crypto?.subtle) { const hash = await host.crypto.subtle.digest('SHA-256', joined);
          record.sha256 = Array.from(new Uint8Array(hash)).map(x => x.toString(16).padStart(2, '0')).join(''); }
      } catch (e) { record.error = String(e.message || e); }
      finally { host.clearTimeout(timer); }
      records.push(record);
    }
    return { schema: 'astra-current-building-source-export-v1', executedByteIdentityProven: false, records };
  }
  function help() {
    const instructions = [
      '1. ASTRABuildingShadowDiagnostic.inventory() — check current API/version inventory; no model request.',
      '2. ASTRABuildingShadowDiagnostic.watchClicks() — observe normal clicks, then wait for the normal card.',
      '3. await ASTRABuildingShadowDiagnostic.probeLastClick() — ONE separate diagnostic route-model query. Frame mismatch/unobserved remains explicit.',
      '   Or await ASTRABuildingShadowDiagnostic.probe({point:{lat:YOUR_LAT,lng:YOUR_LNG},at:EXACT_ISO_TIME}).',
      '4. ASTRABuildingShadowDiagnostic.captureRouteSample({candidateId:YOUR_ID,index:YOUR_INDEX}) — read the existing exact-arrival sample; no rerun.',
      '5. ASTRABuildingShadowDiagnostic.download() — download the raw trace JSON.',
      '6. Optional: await ASTRABuildingShadowDiagnostic.exportLoadedBuildingSources() — source URLs re-fetched; does not authenticate executed bytes.',
      '7. ASTRABuildingShadowDiagnostic.stop() — detach observer and abort diagnostic work.',
      'Private caster/ray/card stages absent from public exports stay unobserved. This diagnostic cannot authorize sun/shade, a production fix, a winner or a seal.'
    ];
    host.console?.info?.(instructions.join('\n')); return instructions;
  }
  return Object.freeze({ limits: LIMITS, inventory, publicAPISources, probe, probeLastClick, watchClicks, stop, dump, download,
    captureRouteSample, captureRecord, buildReport, stageAudit, exportLoadedBuildingSources, help,
    clear() { if (active) throw new Error('STOP_ACTIVE_QUERY_FIRST'); reports.length = 0; usedCharacters = 0; droppedReports = 0; clickState = null; } });
});
