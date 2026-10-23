const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PRIMARY_PORT || 5001;
const REGION = 'us-east-1';
const DATA_PATH = path.join(__dirname, '../data/storage/dataset.json');

let isHealthy = true;
let failureReason = null;
const startTime = Date.now();

// Health check endpoint
app.get('/health', (req, res) => {
  if (!isHealthy) {
    return res.status(503).json({
      status: 'UNHEALTHY',
      region: REGION,
      role: 'PRIMARY',
      error: failureReason || 'Simulated region outage in us-east-1',
      timestamp: new Date().toISOString(),
      uptime_sec: Math.floor((Date.now() - startTime) / 1000)
    });
  }

  res.status(200).json({
    status: 'HEALTHY',
    region: REGION,
    role: 'PRIMARY',
    latency_ms: Math.floor(Math.random() * 8) + 12,
    timestamp: new Date().toISOString(),
    uptime_sec: Math.floor((Date.now() - startTime) / 1000)
  });
});

// Simulation controls
app.post('/api/simulate/fail', (req, res) => {
  const reason = req.body.reason || 'Simulated total AWS us-east-1 power grid outage';
  isHealthy = false;
  failureReason = reason;
  console.log(`[PRIMARY - ${REGION}] INGESTED FAILURE SIMULATION: ${reason}`);
  res.json({ success: true, status: 'UNHEALTHY', region: REGION, reason });
});

app.post('/api/simulate/recover', (req, res) => {
  isHealthy = true;
  failureReason = null;
  console.log(`[PRIMARY - ${REGION}] RECOVERED: Service is back online`);
  res.json({ success: true, status: 'HEALTHY', region: REGION });
});

// Business data endpoints
app.get('/api/data', (req, res) => {
  if (!isHealthy) {
    return res.status(503).json({ error: 'Service Unavailable in us-east-1' });
  }
  try {
    if (fs.existsSync(DATA_PATH)) {
      const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
      return res.json({ region: REGION, count: data.records.length, records: data.records });
    }
    res.json({ region: REGION, count: 0, records: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/data', (req, res) => {
  if (!isHealthy) {
    return res.status(503).json({ error: 'Service Unavailable in us-east-1' });
  }
  try {
    let data = { records: [] };
    if (fs.existsSync(DATA_PATH)) {
      data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    }
    const newRecord = {
      id: `rec-${Date.now().toString(36)}`,
      customer_id: req.body.customer_id || `cust-${Math.floor(Math.random() * 9000 + 1000)}`,
      account_balance: req.body.account_balance || 10000,
      currency: req.body.currency || 'USD',
      region_origin: REGION,
      status: 'COMPLETED',
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
  console.log(`🚀 [PRIMARY REGION] Service running on http://localhost:${PORT} (${REGION})`);
});

module.exports = { app, server };
