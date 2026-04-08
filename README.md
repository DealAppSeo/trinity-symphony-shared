# AI Trinity Symphony — Constitutional Agent Swarm

**Constitutional Agent Swarm for HyperDAG Protocol**

A 12-agent Byzantine Fault Tolerant (BFT) swarm running on Railway, orchestrated through Supabase, governed by constitutional law.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  RAILWAY SWARM                       │
│                                                      │
│  ORCH ──── NEXUS ──── SOPHIA ──── SHOFET            │
│    │         │          │           │                │
│  TORCH     VERITAS    CHESED      MEL               │
│    │         │          │           │                │
│  APM        GCM        HDM        W3C               │
│                                                      │
│         Constitutional Agent Base v5                 │
│         BFT Consensus · RepID Scoring                │
│         ANFIS Routing · Wisdom Cache                 │
└─────────────────────────────────────────────────────┘
```

## 12 Agents

| Agent | Role | Responsibility |
|-------|------|----------------|
| **ORCH** | Orchestrator | Task routing, conductor rotation (20-min tenure), system coordination |
| **NEXUS** | Market Intelligence | Signal fetching, data aggregation, 13 Circle of Fifths signals |
| **SOPHIA** | Trade Execution | Constitutional trading decisions, EIP-712 signing, paper/live execution |
| **SHOFET** | BFT Judge | Pythagorean Comma veto, constitutional refusals, dual-signing |
| **VERITAS** | Validation | Hallucination detection, dissent scoring, proof verification |
| **TORCH** | Content & Monitoring | Social media, system monitoring, content generation |
| **CHESED** | Research | Entity research, contract discovery, knowledge gathering |
| **MEL** | Pattern Analysis | Signal correlation, pattern detection, ANFIS evaluation |
| **APM** | Performance | Agent performance monitoring, metrics, SLA tracking |
| **GCM** | Coordination | Group coordination, inter-agent messaging, consensus |
| **HDM** | Data Management | Schema management, data integrity, on-chain minting |
| **W3C** | Web3 | Smart contract interaction, on-chain operations, ERC-8004 |

## Constitutional Framework

Every agent inherits from `constitutional-agent-base.js` (v5.0 — Unstoppable Wisdom):

### 8 Constitutional Articles
1. **Mission Alignment** — Help people help people
2. **No Single Point of Control** — 20-minute conductor rotation
3. **Transparency** — Log everything
4. **Distributed Truth** — Byzantine fault tolerant consensus
5. **Right to Challenge** — Any agent can challenge any other
6. **Graceful Degradation** — Never crash, always recover
7. **Continuous Evolution** — Self-improving architecture
8. **Wisdom Preservation** — Cache and reuse learnings

### RepID Scoring (0–10,000)
Behavioral reputation system governing agent trust:
- Task completion: +5 to +20
- Finding errors: +12
- Wrong challenge: -3
- Constitutional violation: -100
- Deep reasoning bonus: +3

### BFT Consensus
Pythagorean Comma threshold: `531441/524288 = 1.013643`

13 market signals mapped to the Circle of Fifths. When collective dissonance exceeds the Pythagorean Comma threshold, the agent issues a **Constitutional Refusal** — signed, timestamped, and proved on-chain.

### ANFIS Routing
Adaptive Neuro-Fuzzy Inference System for intelligent task routing based on agent capability scores, current load, and historical performance.

## TrustTrader Integration

This swarm powers [TrustTrader](https://trusttrader.dev/trade) — a constitutional AI trading system:

- **Unity Score** = (Logic × Chaos × Beauty)^(1/φ) where φ = 1.618
- Execute only when Unity > 0.95
- Every decision (approved AND refused) proved on-chain via ERC-8004
- Kraken CLI paper trading with constitutional guardrails

### On-Chain Infrastructure
- **Identity Registry**: `0x8004A818BFB912233c491871b3d84c89A494BD9e` (Base Sepolia)
- **Validation Registry**: `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` (Base Sepolia)
- **Reputation Registry**: `0x8004B663056A597Dffe9eCcC1965A193B7388713` (Base Sepolia)

## Stack

- **Runtime**: Node.js 20+ on Railway
- **Database**: Supabase (PostgreSQL 17)
- **Chain**: Base Sepolia (ERC-8004)
- **Trading**: Kraken CLI (paper mode)
- **AI**: Groq free tier (default), LiteLLM routing
- **Framework**: constitutional-agent-base.js v5

## Repo Structure

```
OneDrive/Desktop/trinity-symphony-shared/
├── shared/                    # Constitutional agent base + nomenclature
│   ├── constitutional-agent-base.js
│   └── nomenclature-constitution.js
├── torch/                     # TORCH agent
├── veritas/                   # VERITAS agent
├── w3c/                       # W3C agent
├── mel/                       # MEL agent
├── hdm/                       # HDM agent
├── apm/                       # APM agent
├── gcm/                       # GCM agent
├── orchestrator/              # ORCH docs
├── scripts/                   # Utilities and seeding
├── utils/                     # Merkle tree, helpers
└── sql/                       # Database schemas
```

## Related Repos

| Repo | Purpose |
|------|---------|
| `trinity-ecosystem` | Next.js backend, TrustTrader pipeline |
| `trustrails-dev` | UI/dashboard (Gemini-managed) |

## License

Proprietary — HyperDAG Protocol / DealApp Inc.

---

*Built with constitutional AI principles. The trades the agent refuses to make are the product.*
