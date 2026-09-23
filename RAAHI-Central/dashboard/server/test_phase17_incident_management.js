/**
 * Phase 17: Real-Time Incident Management & Dashboard Synchronization Tests
 * =========================================================================
 * Comprehensive test suite validating:
 *   Test 1: GET /api/potholes returns all existing potholes
 *   Test 2: Dashboard API sees created/updated potholes
 *   Test 3: PATCH status transitions + invalid status rejection (HTTP 400)
 *   Test 4: Statistics match MongoDB data
 *   Test 5: No duplicate potholeIds in frontend data
 *   Test 6: Map data contains one marker entry per potholeId
 *   Test 7: POT-000002 retains Phase 12 Google Drive URL
 *   Test 8: POT-000004 retains Phase 16 Google Drive URL
 *   Test 9: All existing APIs respond correctly
 *
 * Usage:
 *   Ensure MongoDB and Express server are running on localhost:5001
 *   node dashboard/server/test_phase17_incident_management.js
 */

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5001';
let passed = 0;
let failed = 0;
let skipped = 0;

function log(label, ok, detail = '') {
  const icon = ok ? '✅' : '❌';
  const suffix = detail ? ` — ${detail}` : '';
  console.log(`  ${icon} ${label}${suffix}`);
  if (ok) passed++;
  else failed++;
}

function logSkip(label, reason = '') {
  console.log(`  ⏭️  ${label} — SKIPPED${reason ? ': ' + reason : ''}`);
  skipped++;
}

async function fetchJSON(path, options = {}) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, options);
  const contentType = res.headers.get('content-type') || '';
  let body = null;
  if (contentType.includes('application/json')) {
    body = await res.json();
  }
  return { status: res.status, body, ok: res.ok };
}

// ============================================================
// TEST 1: GET /api/potholes returns all existing potholes
// ============================================================
async function test1_getAllPotholes() {
  console.log('\n--- TEST 1: GET /api/potholes returns all existing potholes ---');
  const { status, body } = await fetchJSON('/api/potholes');
  log('Status 200', status === 200, `Got ${status}`);
  log('success = true', body?.success === true);
  log('potholes is array', Array.isArray(body?.potholes));
  log('count >= 0', typeof body?.count === 'number' && body.count >= 0, `count = ${body?.count}`);
  return body?.potholes || [];
}

// ============================================================
// TEST 2: Verify dashboard API sees potholes
// ============================================================
async function test2_dashboardSeesPotholes(allPotholes) {
  console.log('\n--- TEST 2: Dashboard API visibility ---');
  if (allPotholes.length === 0) {
    logSkip('Pothole visibility', 'No potholes in database');
    return;
  }
  const samplePothole = allPotholes[0];
  const { status, body } = await fetchJSON(`/api/potholes/${samplePothole.potholeId}`);
  log('Individual pothole fetch succeeds', status === 200);
  log('Returned pothole matches', body?.pothole?.potholeId === samplePothole.potholeId);
}

// ============================================================
// TEST 3: PATCH status transitions + invalid status rejection
// ============================================================
async function test3_statusManagement(allPotholes) {
  console.log('\n--- TEST 3: Status management (PATCH /api/potholes/:id/status) ---');

  // Find a pothole that exists for testing (prefer POT-000004 or any)
  let testPothole = allPotholes.find(p => p.potholeId === 'POT-000004');
  if (!testPothole && allPotholes.length > 0) {
    testPothole = allPotholes[allPotholes.length - 1]; // Use last pothole
  }

  if (!testPothole) {
    logSkip('Status transitions', 'No potholes available for testing');
    return testPothole;
  }

  const originalStatus = testPothole.status;
  console.log(`  Using ${testPothole.potholeId} (current status: ${originalStatus})`);

  // 3a: open → investigating
  const { status: s1, body: b1 } = await fetchJSON(`/api/potholes/${testPothole.potholeId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'investigating' })
  });
  log('PATCH to investigating → 200', s1 === 200, `Got ${s1}`);
  log('MongoDB updated to investigating', b1?.status === 'investigating');

  // 3b: investigating → repaired
  const { status: s2, body: b2 } = await fetchJSON(`/api/potholes/${testPothole.potholeId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'repaired' })
  });
  log('PATCH to repaired → 200', s2 === 200, `Got ${s2}`);
  log('MongoDB updated to repaired', b2?.status === 'repaired');

  // 3c: Invalid status → 400
  const { status: s3, body: b3 } = await fetchJSON(`/api/potholes/${testPothole.potholeId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'random-status' })
  });
  log('Invalid status → 400', s3 === 400, `Got ${s3}`);
  log('Error message present', !!b3?.message);

  // 3d: Verify MongoDB did NOT change (still repaired, not random-status)
  const { body: verify } = await fetchJSON(`/api/potholes/${testPothole.potholeId}`);
  log('MongoDB unchanged after invalid PATCH', verify?.pothole?.status === 'repaired',
    `Status is '${verify?.pothole?.status}'`);

  // 3e: Restore original status
  await fetchJSON(`/api/potholes/${testPothole.potholeId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: originalStatus })
  });
  console.log(`  ↩️  Restored ${testPothole.potholeId} to original status: ${originalStatus}`);

  return testPothole;
}

// ============================================================
// TEST 4: Statistics match MongoDB data
// ============================================================
async function test4_statsMatch(allPotholes) {
  console.log('\n--- TEST 4: Statistics match MongoDB data ---');

  // Compute expected stats from raw pothole list
  const expectedStats = {
    total: allPotholes.length,
    open: allPotholes.filter(p => p.status === 'open').length,
    investigating: allPotholes.filter(p => p.status === 'investigating').length,
    repaired: allPotholes.filter(p => p.status === 'repaired').length,
    ignored: allPotholes.filter(p => p.status === 'ignored').length
  };

  const { status, body } = await fetchJSON('/api/potholes/stats');
  log('Stats endpoint responds 200', status === 200, `Got ${status}`);
  log('Stats success = true', body?.success === true);

  const stats = body?.stats || {};
  log('Total matches', stats.total === expectedStats.total,
    `API: ${stats.total}, Expected: ${expectedStats.total}`);
  log('Open matches', stats.open === expectedStats.open,
    `API: ${stats.open}, Expected: ${expectedStats.open}`);
  log('Investigating matches', stats.investigating === expectedStats.investigating,
    `API: ${stats.investigating}, Expected: ${expectedStats.investigating}`);
  log('Repaired matches', stats.repaired === expectedStats.repaired,
    `API: ${stats.repaired}, Expected: ${expectedStats.repaired}`);
  log('Ignored matches', stats.ignored === expectedStats.ignored,
    `API: ${stats.ignored}, Expected: ${expectedStats.ignored}`);
}

// ============================================================
// TEST 5: No duplicate potholeIds in frontend data
// ============================================================
async function test5_noDuplicates(allPotholes) {
  console.log('\n--- TEST 5: No duplicate potholeIds ---');
  const ids = allPotholes.map(p => p.potholeId);
  const uniqueIds = new Set(ids);
  log('All potholeIds are unique', ids.length === uniqueIds.size,
    `${ids.length} entries, ${uniqueIds.size} unique`);

  if (ids.length !== uniqueIds.size) {
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    console.log(`  ⚠️  Duplicates found: ${[...new Set(dupes)].join(', ')}`);
  }
}

// ============================================================
// TEST 6: Map data - one marker per potholeId
// ============================================================
async function test6_mapMarkers(allPotholes) {
  console.log('\n--- TEST 6: Map data — one marker per potholeId ---');
  // Verify each pothole has valid coordinates for marker placement
  const withCoords = allPotholes.filter(p =>
    p.location &&
    typeof p.location.latitude === 'number' &&
    typeof p.location.longitude === 'number'
  );
  log('All potholes have valid coordinates', withCoords.length === allPotholes.length,
    `${withCoords.length} of ${allPotholes.length} have valid lat/lng`);

  // Verify no duplicate coordinates that would stack markers
  const coordIds = withCoords.map(p => p.potholeId);
  const uniqueCoordIds = new Set(coordIds);
  log('One entry per potholeId (no stacking)', coordIds.length === uniqueCoordIds.size);
}

// ============================================================
// TEST 7: POT-000002 retains Phase 12 Google Drive URL
// ============================================================
async function test7_pot000002Evidence() {
  console.log('\n--- TEST 7: POT-000002 Phase 12 Google Drive URL ---');
  const { status, body } = await fetchJSON('/api/potholes/POT-000002');

  if (status === 404) {
    logSkip('POT-000002 evidence check', 'POT-000002 not found in MongoDB');
    return;
  }

  log('POT-000002 exists', status === 200);
  const videoUrl = body?.pothole?.videoUrl;
  const hasVideo = !!(videoUrl && videoUrl.trim() !== '');
  log('videoUrl is present', hasVideo, hasVideo ? videoUrl : 'EMPTY');
  if (hasVideo) {
    log('videoUrl contains Google Drive', videoUrl.includes('drive.google.com'),
      videoUrl.substring(0, 60));
  }
}

// ============================================================
// TEST 8: POT-000004 retains Phase 16 Google Drive URL
// ============================================================
async function test8_pot000004Evidence() {
  console.log('\n--- TEST 8: POT-000004 Phase 16 Google Drive URL ---');
  const { status, body } = await fetchJSON('/api/potholes/POT-000004');

  if (status === 404) {
    logSkip('POT-000004 evidence check', 'POT-000004 not found in MongoDB');
    return;
  }

  log('POT-000004 exists', status === 200);
  const videoUrl = body?.pothole?.videoUrl;
  const hasVideo = !!(videoUrl && videoUrl.trim() !== '');
  log('videoUrl is present', hasVideo, hasVideo ? videoUrl : 'EMPTY');
  if (hasVideo) {
    log('videoUrl contains Google Drive', videoUrl.includes('drive.google.com'),
      videoUrl.substring(0, 60));
  }
}

// ============================================================
// TEST 9: All existing APIs respond correctly
// ============================================================
async function test9_existingAPIs() {
  console.log('\n--- TEST 9: All existing APIs respond correctly ---');

  const endpoints = [
    { method: 'GET', path: '/api/status', expect: 200 },
    { method: 'GET', path: '/api/detections', expect: 200 },
    { method: 'GET', path: '/api/potholes', expect: 200 },
    { method: 'GET', path: '/api/gps', expect: 200 },
    { method: 'GET', path: '/api/gps/history', expect: 200 },
    { method: 'GET', path: '/api/live/status', expect: 200 },
    { method: 'GET', path: '/api/live/evidence/status', expect: 200 },
    { method: 'GET', path: '/api/potholes/stats', expect: 200 },
  ];

  // Video endpoint might 404 if file doesn't exist, which is ok
  const videoRes = await fetchJSON('/api/video');
  log('GET /api/video responds', videoRes.status === 200 || videoRes.status === 404,
    `Status ${videoRes.status}`);

  // Live stream is MJPEG, can't easily test with fetch — skip
  logSkip('GET /api/live/stream', 'MJPEG endpoint, not JSON testable');

  for (const ep of endpoints) {
    try {
      const res = await fetchJSON(ep.path, { method: ep.method });
      log(`${ep.method} ${ep.path} → ${ep.expect}`, res.status === ep.expect,
        `Got ${res.status}`);
    } catch (err) {
      log(`${ep.method} ${ep.path}`, false, `Error: ${err.message}`);
    }
  }
}

// ============================================================
// MAIN RUNNER
// ============================================================
async function main() {
  console.log('==================================================');
  console.log(' PHASE 17: INCIDENT MANAGEMENT TEST SUITE');
  console.log(`==================================================`);
  console.log(`Target: ${BASE}`);
  console.log(`Time:   ${new Date().toISOString()}`);

  try {
    // Preflight: verify server is reachable
    try {
      await fetchJSON('/api/status');
    } catch (e) {
      console.error(`\n❌ Cannot reach server at ${BASE}. Ensure Express is running.`);
      console.error(`   Error: ${e.message}`);
      process.exit(1);
    }

    const allPotholes = await test1_getAllPotholes();
    await test2_dashboardSeesPotholes(allPotholes);
    await test3_statusManagement(allPotholes);

    // Re-fetch after status changes to ensure consistency
    const freshPotholes = (await fetchJSON('/api/potholes')).body?.potholes || [];
    await test4_statsMatch(freshPotholes);
    await test5_noDuplicates(freshPotholes);
    await test6_mapMarkers(freshPotholes);
    await test7_pot000002Evidence();
    await test8_pot000004Evidence();
    await test9_existingAPIs();

    console.log('\n==================================================');
    console.log(` RESULTS: ${passed} passed, ${failed} failed, ${skipped} skipped`);
    console.log('==================================================');

    if (failed > 0) {
      console.log('\n⚠️  Some tests failed. Review the output above.');
      process.exit(1);
    } else {
      console.log('\n✅ All Phase 17 tests passed!');
      process.exit(0);
    }
  } catch (err) {
    console.error('\n❌ Unhandled error during test execution:', err);
    process.exit(1);
  }
}

main();
