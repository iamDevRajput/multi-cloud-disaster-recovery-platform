#!/bin/bash
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "========================================================"
echo "⚡ Starting Multi-Cloud Disaster Recovery MVP Platform"
echo "========================================================"

# Clear any existing ports
lsof -ti :8080,5001,5002 | xargs kill -9 2>/dev/null || true

# Start Cluster Supervisor in background
node backend/cluster.js > data/cluster.log 2>&1 &
CLUSTER_PID=$!

sleep 2

echo "========================================================"
echo "✅ Cluster Supervisor Running with PID: $CLUSTER_PID"
echo "🌐 Dashboard URL:    http://localhost:8080"
echo "📡 Primary Service:  http://localhost:5001/health"
echo "🛡️ DR Service:       http://localhost:5002/health"
echo "========================================================"
