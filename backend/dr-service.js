const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.DR_PORT || 5002;
const REGION = 'us-west-2';
const DATA_PATH = path.join(__dirname, '../data/storage/dr_replica_dataset.json');
const PRIMARY_DATA_PATH = path.join(__dirname, '../data/storage/dataset.json');

let isHealthy = true;
let isPromoted = false; // Standby by default; promotes to ACTIVE upon failover
let failureReason = null;
const startTime = Date.now();

// Health check endpoint
app.get('/health', (req, res) => {
  if (!isHealthy) {
    return res.status(503).json({
      status: 'UNHEALTHY',
      region: REGION,
      role: isPromoted ? 'ACTIVE_FAILOVER' : 'STANDBY_DR',
      error: failureReason || 'Simulated outage in us-west-2 DR region',
      timestamp: new Date().toISOString(),
      uptime_sec: Math.floor((Date.now() - startTime) / 1000)
    });
  }

  res.status(200).json({
    status: 'HEALTHY',
    region: REGION,
    role: isPromoted ? 'ACTIVE_FAILOVER' : 'STANDBY_DR',
    latency_ms: Math.floor(Math.random() * 8) + 24, // slightly higher latency across regions
    timestamp: new Date().toISOString(),
    uptime_sec: Math.floor((Date.now() - startTime) / 1000)
  });
});

// Promotion and Standby toggles
app.post('/api/promote', (req, res) => {
  isPromoted = true;
  console.log(`[DR - ${REGION}] PROMOTED TO ACTIVE RECOVERY SERVICE`);
  
  // Replicate primary data if not yet present
  try {
    if (fs.existsSync(PRIMARY_DATA_PATH) && !fs.existsSync(DATA_PATH)) {
      fs.copyFileSync(PRIMARY_DATA_PATH, DATA_PATH);
    }
  } catch (err) {
    console.warn(`[DR - ${REGION}] Replica sync notice:`, err.message);
  }

  res.json({
    success: true,
    status: 'HEALTHY',
    role: 'ACTIVE_FAILOVER',
    region: REGION,
    promoted_at: new Date().toISOString()
  });
});

app.post('/api/demote', (req, res) => {
  isPromoted = false;
  console.log(`[DR - ${REGION}] DEMOTED BACK TO STANDBY RECOVERY SERVICE`);
  res.json({
    success: true,
    status: 'HEALTHY',
    role: 'STANDBY_DR',
    region: REGION,
    demoted_at: new Date().toISOString()
  });
});

// Simulation controls
app.post('/api/simulate/fail', (req, res) => {
  const reason = req.body.reason || 'Simulated network partition in us-west-2';
  isHealthy = false;
  failureReason = reason;
  console.log(`[DR - ${REGION}] INGESTED FAILURE SIMULATION: ${reason}`);
  res.json({ success: true, status: 'UNHEALTHY', region: REGION, reason });
});

app.post('/api/simulate/recover', (req, res) => {
  isHealthy = true;
  failureReason = null;
  console.log(`[DR - ${REGION}] RECOVERED: Service is back online`);
  res.json({ success: true, status: 'HEALTHY', region: REGION });
});

// Business data endpoints
app.get('/api/data', (req, res) => {
  if (!isHealthy) {
    return res.status(503).json({ error: 'Service Unavailable in us-west-2' });
  }
  try {
    const targetFile = fs.existsSync(DATA_PATH) ? DATA_PATH : PRIMARY_DATA_PATH;
    if (fs.existsSync(targetFile)) {
      const data = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
      return res.json({
        region: REGION,
        role: isPromoted ? 'ACTIVE_FAILOVER' : 'STANDBY_DR',
        count: data.records.length,
        records: data.records
      });
    }
    res.json({ region: REGION, count: 0, records: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/data', (req, res) => {
  if (!isHealthy) {
    return res.status(503).json({ error: 'Service Unavailable in us-west-2' });
  }
  try {
    const targetFile = fs.existsSync(DATA_PATH) ? DATA_PATH : PRIMARY_DATA_PATH;
    let data = { records: [] };
    if (fs.existsSync(targetFile)) {
      data = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
    }
    const newRecord = {
      id: `rec-dr-${Date.now().toString(36)}`,
      customer_id: req.body.customer_id || `cust-${Math.floor(Math.random() * 9000 + 1000)}`,
      account_balance: req.body.account_balance || 15000,
      currency: req.body.currency || 'USD',
      region_origin: REGION,
      status: 'REPLICATED_DR',
      timestamp: new Date().toISOString()
    };
    data.records.push(newRecord);
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
    res.status(201).json({ success: true, region: REGION, record: newRecord });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const server = app.listen(PORT, () => {
  console.log(`🛡️ [DR SECONDARY REGION] Service running on http://localhost:${PORT} (${REGION})`);
});

module.exports = { app, server };
