---

## HyperDAG Protocol Rules (Sean-authored)

- CLAUDE-RULE-1: Verify before building. Query existing state before creating new state.
- CLAUDE-RULE-2: Describe vs execute. Never auto-execute infrastructure changes without "GO".
- CLAUDE-RULE-3: Code discipline. Fix only what's named. No scope creep.
- CLAUDE-RULE-4: Truth principles. Honest > flattering. "I don't know" > fabrication.
- CLAUDE-RULE-5: Schema first. Query information_schema before SQL. trinity_tasks.id is BIGINT, not UUID.
- CLAUDE-RULE-6: Efficiency. Shortest path to done. No busywork.

## Architectural Principles (first-class)

1. Persistent stateful channels beat repeated stateless calls when state is heavy and turns are short.
2. Latency is opportunity. The gap between signal and response is where alignment work happens.
3. ANFIS/LASSO at every decision point. Pattern learning and anticipatory metrics measuring prediction quality.
4. Reward functions grounded in declared purpose alignment, not engagement maximization.
5. Multi-source signals with explicit attestation chains. Where did this come from? Why is it trusted?

## Hard Stops (Marco/Vitto/Leonard contributor protections)

Files in packages/contracts/ are protected. Do not modify:
- packages/contracts/ERC8004SPEC.md
- packages/contracts/contracts/*
- packages/contracts/test/*
- packages/contracts/abis/*

## Tooling Notes

- GitNexus auto-generation skipped due to broken tree-sitter-dart SSH dependency in the project. Manual rules block in use until GitNexus dependency is fixed upstream or Codebase-Memory alternative is evaluated.

---
