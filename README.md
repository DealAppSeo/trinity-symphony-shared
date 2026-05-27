<div align="center">
  <h1>trinity-symphony-shared</h1>
  <p><strong>Part of the HyperDAG Ecosystem</strong></p>
  <p>
    <img src="https://img.shields.io/badge/status-active-success.svg" alt="Status" />
    <img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License" />
  </p>
</div>

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Core](https://img.shields.io/badge/Logic-Constitutional-orange)](https://aitrinitysymphony.com)

**Constitutional logic and core BFT primitives for the AI Trinity Symphony.**

`trinity-symphony-shared` contains the guardrails, fuzzy-inference models, and consensus protocols used by
the Trinity Symphony agents. It provides the constitutional agent base, the ANFIS bid resolver, and the
shared BFT validation primitives the swarm relies on.

---

## 🏗️ Technical Architecture: BFT 3x3+3

This package implements a **Triple-Ply Byzantine Fault Tolerant** model, so that no single LLM family or
agent can compromise the integrity of a decision.

```mermaid
graph LR
    subgraph "Execution Layer (Ply 1)"
    E1[Executor A]
    E2[Executor B]
    E3[Executor C]
    end
    
    subgraph "Verification Layer (Ply 2)"
    V1[Verifier X]
    V2[Verifier Y]
    V3[Verifier Z]
    end
    
    E1 & E2 & E3 --> V1 & V2 & V3
    V1 & V2 & V3 --> ANFIS[ANFIS Consensus Ply 3]
    ANFIS --> Truth[Verifiable Truth]
```

### Core Primitives
- **Constitutional Agent Base**: The foundation for all agents, enforcing [Philippians 4:8](CONSTITUTION.md) adherence at the system level.
- **ANFIS Bid Resolver**: An Adaptive Neuro-Fuzzy Inference System that scores agent bids on **Cost, Efficiency, and Flexibility**.
- **Evolutionary Logger**: A recursive feedback system that logs each "learning event" into a vault for self-optimization.
- **Pruning Engine**: Implements **Evolutionary Swarm Pruning (ESP)** to cull inefficient behaviors over time.

---

## 🧬 Squad Specializations

- **ALPHA (Truth Squad)**: Ethics verification, deep research, and BFT governance.
- **BETA (Care Squad)**: UI choreography, user experience, and interaction.
- **GAMMA (Build Squad)**: Infrastructure orchestration, Web3 bridging, and deployment automation.

---

## 🛠️ Implementation Details

### ANFIS Fuzzy Logic
Routing uses triangular membership functions rather than simple thresholds, to handle the "grey areas" of
computational triage.
```typescript
// Example membership function from our core
const isLow = (v: number) => Math.max(0, 1 - v * 2);
const isHigh = (v: number) => Math.max(0, (v - 0.5) * 2);
```

### Self-Healing Loop
When the **Evolutionary Logger** detects a persistent failure pattern, it triggers a **Self-Healing Pulse**,
which can demote underperforming LLM providers or re-route tasks to higher-reputation agents.

---

## 🏗️ Ecosystem Governance

The **protocol-wide** governance roadmap (RepID formula, Pythagorean Comma damping, peer-verification thresholds, the V1 → V3 path toward a DAO) is canonical at
[**hyperdag-protocol / GOVERNANCE_ROADMAP.md**](https://github.com/DealAppSeo/hyperdag-protocol/blob/main/GOVERNANCE_ROADMAP.md).

This repo (`trinity-symphony-shared`) governs the **swarm-local** surface that runs on top of the protocol:

- **Agent constitutions** — what an individual agent will and will not do
- **Swarm policies** — BFT quorum thresholds, ALPHA Truth Squad rules, squad-role escalation paths
- **Ethics logic** — the kernel that adjudicates agent decisions before they propagate

| Repository | Role | Technology Stack |
| :--- | :--- | :--- |
| **[hyperdag-protocol](https://github.com/DealAppSeo/hyperdag-protocol)** | Truth | Solidity, Circom, Merkle DAG |
| **[trinity-symphony-shared](https://github.com/DealAppSeo/trinity-symphony-shared)** | Soul | Custom BFT, ANFIS, Ethics Logic |

[Constitution](CONSTITUTION.md) • [Contributing](CONTRIBUTING.md) • [Security](SECURITY.md)

---

## 🔗 Ecosystem Projects

- [TrustShell](https://trustshell.dev) — Web3 Agent SDK
- [TrustRepID](https://trustrepid.dev) — Reputation leaderboard and verification dashboard
- [TrustChat](https://trustchat.dev) — Secure client chat experience
- [hyperdag-protocol](https://github.com/DealAppSeo/hyperdag-protocol) — L1 validation specification
- [repid-engine](https://github.com/DealAppSeo/repid-engine) — Open-source behavioral reputation scoring engine

---

## 🤝 Contributing

Community contributions are welcome. See [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md) to get started — bug fixes, documentation improvements, and feature proposals are all appreciated.

---

**Part of the HyperDAG Protocol ecosystem.**

- [TrustShell](https://trustshell.dev) — SDK
- [TrustRepID](https://trustrepid.dev) — Reputation leaderboard
- [TrustChat](https://trustchat.dev) — Consumer experience
- [HyperDAG Protocol](https://github.com/DealAppSeo/hyperdag-protocol) — Protocol spec

ERC-8004 compatible. Apache 2.0 licensed. Micah 6:8.

**On-chain footprint (Base Sepolia, chain ID 84532):**
- IdentityRegistry — [`0x8004A818BFB912233c491871b3d84c89A494BD9e`](https://sepolia.basescan.org/address/0x8004A818BFB912233c491871b3d84c89A494BD9e)
- ReputationRegistry — [`0x8004B663056A597Dffe9eCcC1965A193B7388713`](https://sepolia.basescan.org/address/0x8004B663056A597Dffe9eCcC1965A193B7388713)
