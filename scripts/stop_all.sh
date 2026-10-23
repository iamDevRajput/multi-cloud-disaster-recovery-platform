#!/bin/bash
echo "Stopping Multi-Cloud Disaster Recovery Platform services..."
lsof -ti :8080,5001,5002 | xargs kill -9 2>/dev/null || true
echo "✅ All services stopped."
