/**
 * Automated Disaster Recovery & Backup Integrity Verification Suite
 * Tests:
 * 1. Primary Service Health (HTTP 200)
 * 2. Secondary DR Service Health (HTTP 200, Standby mode)
 * 3. Primary Outage Injection & Failover Detection to Secondary
 * 4. Recovery Signal & Repeatable Failback to Primary
 * 5. Backup Creation & Manifest SHA-256 Generation
 * 6. Restore to Segregated Location & Checksum Byte-Verification
 * 7. Corrupted Backup Tamper Detection & Integrity Rejection
 * 8. Missing Backup Exception Trapping
 * 9. Terraform fmt and validation verification
 */

const http = require('http');
const assert = require('assert');
const { execSync } = require('child_process');
const path = require('path');

const ORCHESTRATOR = 'http://127.0.0.1:8080';
const PRIMARY = 'http://127.0.0.1:5001';
const DR = 'http://127.0.0.1:5002';

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = http.request(reqOpts, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch (e) { json = body; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });

    req.on('error', reject);
    if (options.body) {
      const data = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      req.setHeader('Content-Type', 'application/json');
      req.setHeader('Content-Length', Buffer.byteLength(data));
      req.write(data);
    }
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 MULTI-CLOUD DISASTER RECOVERY & BACKUP TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    process.stdout.write(`[TEST ${total}] ${name} ... `);
    try {
      await fn();
      passed++;
      console.log('✅ PASSED');
    } catch (err) {
      console.log(`❌ FAILED: ${err.message}`);
    }
  }

  // Test 1: Primary Health
  await test('Primary Service Health Check (/health returns 200 OK)', async () => {
    const res = await request(`${PRIMARY}/health`);
    assert.strictEqual(res.status, 200, `Expected status 200, got ${res.status}`);
    assert.strictEqual(res.body.status, 'HEALTHY');
    assert.strictEqual(res.body.region, 'us-east-1');
    assert.strictEqual(res.body.role, 'PRIMARY');
  });

  // Test 2: DR Service Health
  await test('DR Secondary Health Check (/health returns 200 OK)', async () => {
    const res = await request(`${DR}/health`);
    assert.strictEqual(res.status, 200, `Expected status 200, got ${res.status}`);
    assert.strictEqual(res.body.status, 'HEALTHY');
    assert.strictEqual(res.body.region, 'us-west-2');
  });

  // Test 3: Orchestrator Ingress & Active Region
  await test('Orchestrator Global Status (Default active region is us-east-1)', async () => {
    const res = await request(`${ORCHESTRATOR}/api/dr/status`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.active_region, 'us-east-1');
    assert.strictEqual(res.body.primary_health.status, 'HEALTHY');
  });

  // Test 4: Primary Outage Simulation & Failover
  await test('Failover Trigger & Promotion of DR Region (us-west-2)', async () => {
    // 1. Simulate outage on primary
    const simRes = await request(`${PRIMARY}/api/simulate/fail`, { method: 'POST', body: { reason: 'Automated test power failure' } });
    assert.strictEqual(simRes.status, 200);

    // 2. Trigger failover
    const failoverRes = await request(`${ORCHESTRATOR}/api/dr/failover`, {
      method: 'POST',
      body: { reason: 'AUTOMATED_TEST_TRIGGER' }
    });
    assert.strictEqual(failoverRes.status, 200);
    assert.strictEqual(failoverRes.body.active_region, 'us-west-2');

    // 3. Verify orchestrator now routes to DR
    const statusRes = await request(`${ORCHESTRATOR}/api/dr/status`);
    assert.strictEqual(statusRes.body.active_region, 'us-west-2');

    // 4. Verify DR service was promoted
    const drRes = await request(`${DR}/health`);
    assert.strictEqual(drRes.body.role, 'ACTIVE_FAILOVER');
  });

  // Test 5: Recovery and Failback
  await test('Repeatable Primary Recovery & Failback', async () => {
    // 1. Recover primary
    const recRes = await request(`${PRIMARY}/api/simulate/recover`, { method: 'POST' });
    assert.strictEqual(recRes.status, 200);

    // Allow poll to detect recovery
    await sleep(3500);

    // 2. Execute failback
    const failbackRes = await request(`${ORCHESTRATOR}/api/dr/failback`, { method: 'POST' });
    assert.strictEqual(failbackRes.status, 200);
    assert.strictEqual(failbackRes.body.active_region, 'us-east-1');

    // 3. Verify orchestrator active region is back to us-east-1
    const statusRes = await request(`${ORCHESTRATOR}/api/dr/status`);
    assert.strictEqual(statusRes.body.active_region, 'us-east-1');
  });

  // Test 6: Backup Creation & SHA-256 Manifest
  let createdManifest = null;
  await test('Backup Creation with Cryptographic SHA-256 Manifest', async () => {
    const res = await request(`${ORCHESTRATOR}/api/backup/create`, { method: 'POST' });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.success, true);
    assert(res.body.manifest.sha256, 'Manifest must contain sha256 checksum');
    assert.strictEqual(res.body.manifest.sha256.length, 64, 'SHA-256 must be 64 hex characters');
    assert(res.body.manifest.records_count >= 1, 'Records count should be >= 1');
    createdManifest = res.body.manifest;
  });

  // Test 7: Successful Restore and SHA-256 Verification
  await test('Restore to Segregated Target & SHA-256 Integrity Verification', async () => {
    const res = await request(`${ORCHESTRATOR}/api/backup/restore`, {
      method: 'POST',
      body: { manifest_file: createdManifest.manifest_file }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'VERIFIED_INTEGRITY');
    assert.strictEqual(res.body.checksum_match, true);
    assert.strictEqual(res.body.manifest_sha256, createdManifest.sha256);
    assert.strictEqual(res.body.restored_sha256, createdManifest.sha256);
  });

  // Test 8: Corrupted Backup Detection
  await test('Corrupted Backup Tamper Detection and Rejection', async () => {
    const res = await request(`${ORCHESTRATOR}/api/backup/test-corruption`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.simulation_outcome, 'TAMPER_DETECTED_AND_REJECTED');
    assert.strictEqual(res.body.checksum_match, false);
    assert.notStrictEqual(res.body.expected_manifest_sha256, res.body.tampered_file_sha256);
  });

  // Test 9: Missing Backup Trapping
  await test('Missing Backup Error Trapping (Returns 404 cleanly)', async () => {
    const res = await request(`${ORCHESTRATOR}/api/backup/test-missing`, { method: 'POST' });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.simulation_outcome, 'HANDLED_GRACEFULLY');
  });

  // Test 10: Terraform Format and Validation
  await test('Terraform Foundation Validation (terraform fmt & validate)', async () => {
    const infraPath = path.join(__dirname, '../infra');
    const fmtResult = execSync('terraform fmt -check', { cwd: infraPath, encoding: 'utf8' });
    assert.strictEqual(fmtResult, ''); // empty means clean format

    const validateResult = execSync('terraform validate -no-color', { cwd: infraPath, encoding: 'utf8' });
    assert(validateResult.includes('Success! The configuration is valid.'));
  });

  console.log('\n================================================================');
  console.log(`📊 TEST RESULTS: ${passed}/${total} PASSED (${Math.round((passed / total) * 100)}%)`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
