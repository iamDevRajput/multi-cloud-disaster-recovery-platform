/**
 * Unified Multi-Cloud Disaster Recovery Cluster Supervisor
 * Launches all 3 microservices concurrently in one supervised runtime:
 * - Port 5001: Primary Region Microservice (us-east-1)
 * - Port 5002: Disaster Recovery Standby Microservice (us-west-2)
 * - Port 8080: Disaster Recovery Orchestrator & Dashboard
 */

console.log('=======================================================');
console.log('⚡ Launching Multi-Cloud Disaster Recovery Cluster...');
console.log('=======================================================');

require('./primary-service');
require('./dr-service');
require('./dr-engine');

console.log('✅ All cluster microservices initialized and supervised.');
