# Multi-Cloud Disaster Recovery & Backup Automation Platform — Architecture Specification

## 1. Executive Architecture Overview
The platform provides a high-availability, multi-region disaster recovery (DR) and automated cryptographic backup orchestration framework. Designed for business continuity across active and recovery zones, the system automates:
- Real-time continuous HTTP synthetic health probing.
- Multi-region active/standby ingress routing.
- Sub-second automated failure detection and promotion of standby secondary clusters.
- Repeatable failback restoration once primary cluster health returns to 100%.
- Cryptographically signed local/cloud backups using SHA-256 integrity manifests.
- Isolated restoration validation ensuring bit-level integrity before database hydration.

> [!NOTE]
> **Architectural Attribution**: The multi-region active-active cloud topology and AWS service selection (VPC, Aurora Global DB, S3 CRR, Route 53) references the foundational architecture described in [ShamailAbbas/aws-terraform-multi-region-active-active-disaster-recovery](https://github.com/ShamailAbbas/aws-terraform-multi-region-active-active-disaster-recovery). All orchestration logic, health probing, backup/restore verification, and dashboard systems are independently implemented original work.

```mermaid
flowchart TD
    Client[("🌍 Global Client Ingress")] --> Route53["Anycast DNS / Traffic Router (Route 53)"]
    
    subgraph PrimaryRegion ["Primary Region: US-East (us-east-1)"]
        ALB_Primary["Ingress Gateway (Port 5001)"]
        Compute_Primary["Primary Application Cluster"]
        DB_Primary[("Aurora Global DB (Primary Read/Write)")]
        S3_Primary[("Primary S3 Media Storage")]
    end

    subgraph DRRegion ["Disaster Recovery Region: US-West (us-west-2)"]
        ALB_DR["Recovery Gateway (Port 5002)"]
        Compute_DR["Warm Standby DR Cluster"]
        DB_DR[("Aurora Read Replica (Promotable)")]
        S3_DR[("Cross-Region Replicated S3 Storage")]
    end

    Route53 -- Active Traffic --> ALB_Primary
    ALB_Primary --> Compute_Primary
    Compute_Primary --> DB_Primary
    Compute_Primary --> S3_Primary

    Route53 -. Failover Ingress .-> ALB_DR
    ALB_DR --> Compute_DR
    Compute_DR --> DB_DR
    Compute_DR --> S3_DR

    DB_Primary == Async Storage Replication ==> DB_DR
    S3_Primary == S3 Cross-Region Replication (CRR) ==> S3_DR

    subgraph OrchestratorEngine ["Disaster Recovery Engine (Port 8080)"]
        HealthPoller["Continuous Health Probe (3s intervals)"]
        FailoverController["Auto-Failover & Failback State Machine"]
        BackupVerifier["SHA-256 Manifest & Checksum Verifier"]
    end

    HealthPoller -->|Probe /health| ALB_Primary
    HealthPoller -->|Probe /health| ALB_DR
    FailoverController -->|Trigger Failover / Promotion| Route53
    BackupVerifier -->|Checksum Validation| S3_Primary
```

---

## 2. Multi-Region Failover State Machine

The failover lifecycle ensures that no transient network spike causes an unnecessary regional shift while guaranteeing immediate failover when a true failure threshold is reached:

```mermaid
stateDiagram-v2
    [*] --> PrimaryActive : Cluster Startup
    PrimaryActive --> PrimaryDegraded : Health Check 1 Fails (503/Timeout)
    PrimaryDegraded --> PrimaryActive : Health Check Recovers (200 OK)
    PrimaryDegraded --> FailoverTriggered : Health Check 2 Fails (Threshold Exceeded)
    
    state FailoverTriggered {
        [*] --> PromoteDR : Send POST /api/promote to us-west-2
        PromoteDR --> RouteTraffic : Shift Ingress Route to Secondary
        RouteTraffic --> LogEvent : Emit CRITICAL Failover Audit Log
    }

    FailoverTriggered --> DRActive : DR Regional Cluster Promoted
    DRActive --> PrimaryRecovered : Primary Probe Detects 200 OK
    PrimaryRecovered --> FailbackInitiated : Operator / Policy Triggers Failback
    
    state FailbackInitiated {
        [*] --> DemoteDR : Demote us-west-2 back to Standby
        DemoteDR --> RoutePrimary : Shift Ingress Route to us-east-1
        RoutePrimary --> LogSuccess : Emit SUCCESS Audit Log
    }

    FailbackInitiated --> PrimaryActive : Normal Operations Restored
```

---

## 3. Cryptographic Backup & Restore Verification Flow

To prevent data rot, bit-flip errors, or compromised backup archives from polluting production datasets, the platform implements an immutable verification pipeline:

```mermaid
sequenceDiagram
    autonumber
    actor Operator
    participant Orch as DR Orchestrator
    participant Storage as Data Storage (dataset.json)
    participant Backups as Backup Directory
    participant Manifest as SHA-256 Manifest
    participant Restored as Segregated Restore Target

    Note over Operator,Restored: Backup Creation Pipeline
    Operator->>Orch: Trigger Create Instant Backup
    Orch->>Storage: Read active dataset records
    Orch->>Backups: Write snapshot backup_{timestamp}.json
    Orch->>Backups: Calculate SHA-256 cryptographic digest
    Orch->>Manifest: Save manifest_{timestamp}.json (SHA-256, Size, Timestamp)
    Orch-->>Operator: Return Signed Manifest

    Note over Operator,Restored: Restore & Integrity Verification Pipeline
    Operator->>Orch: Trigger Restore & Verify Checksum
    Orch->>Manifest: Load expected SHA-256 hash
    Orch->>Backups: Read backup archive file
    Orch->>Restored: Copy to restored_{timestamp}.json (isolated path)
    Orch->>Restored: Compute SHA-256 of restored payload
    alt Hash Matches Exactly (100% Byte Identity)
        Orch-->>Operator: 200 OK (VERIFIED_INTEGRITY)
    else Hash Mismatch (Corrupted or Tampered File)
        Orch-->>Operator: 422 Unprocessable Entity (CORRUPTION_DETECTED)
    end
```

---

## 4. Terraform Multi-Region Foundation
The infrastructure foundation in `infra/` specifies:
1. **Multi-Provider Configuration**: Dual AWS provider blocks targeting `us-east-1` (primary) and `us-west-2` (secondary).
2. **Dual VPC Architecture**: Segregated VPCs across both regions with public/private subnet tiers, route tables, and Internet Gateways.
3. **Database Layer**: AWS Aurora Global Database cluster spanning primary and secondary regions for sub-second storage-level replication.
4. **Object Storage**: S3 bucket with versioning and Cross-Region Replication (CRR) configured via IAM replication roles.
5. **DNS & Health Routing**: Route 53 health check alarms with failover routing policies.
