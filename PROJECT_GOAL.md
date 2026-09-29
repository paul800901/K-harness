# K Harness — Project Goal

## 核心定位

K Harness 的核心目標是：

> **保留第一方強模型 Harness 作為唯一主要決策層，再把不值得由昂貴主腦親自執行的工作，交給較便宜、受控、可驗證的 worker。**

K Harness 不是要重新實作 Codex 或 Claude Code，也不是要建立第二套完整 Agent OS。

## 主腦不變條件

主要決策者應維持在高能力第一方 Harness：
```text
GPT
→ Codex / Codex app-server

Claude
→ Claude Code
```

主腦負責：

- 高階規劃
- 任務拆分
- 風險判斷
- 衝突處理
- 是否擴大工作範圍
- 成果驗收
- 最終決策

不要為了節省成本，把主要判斷責任下放給 DeepSeek、Kimi、GLM 等廉價 worker。

成本最佳化應優先發生在「主腦不必親自做的工作」，而不是降低主腦本身的能力。

## K Harness 架構
```text
Codex / Claude Code
強主腦、唯一主要 orchestration authority
        ↓
K Harness
delegation / routing / evidence boundary
        ↓
Pi-based worker runtime
        ↓
DeepSeek / Kimi / other cheap workers
```

目前 K Harness 的 Pi worker 層應維持薄且受控。

## K Harness 應負責

K Harness 主要負責：

- cheap worker routing
- task contract
- selective context transfer
- 明確 capability / file grants
- bounded worker execution
- evidence return
- artifact reference
- recovery / status inspection
- token / cost accounting
- GPT／Claude 主腦與廉價 worker 之間的 context-efficient handoff

## K Harness 不應自行重做

除非有已證實且不可由上層主腦 Harness 解決的需求，否則不要在 K worker plane 再建立：

- 第二套高階 planner
- 第二套主要 workflow engine
- 第二套 agent-team hierarchy
- 第二套長任務 orchestration authority
- 第二個完整 autonomous agent platform
- 為了功能完整而複製 Codex／Claude Code 已有能力

一個 task tree 預設只應有一個主要 orchestration authority：

> **Codex 或 Claude Code。**

## Pi 的定位

Pi 在 K Harness 中不是完整主腦平臺，而是：

> **輕量、跨 provider、可嵌入、可控制的 worker execution substrate。**

Pi 少掉的完整 workflow、agent teams、治理系統等能力，在 K 架構中多數不是缺陷，因為這些責任已由上層第一方 Harness 承擔。

不要把 Pi 逐步堆成另一個 DSH。

## 可吸收的效率能力

可以吸收 Pi／SoL-Pi／其他 Harness 中只作用於 worker execution efficiency 的機制，例如：

- Observation packing / spill
- selective recall
- deterministic action fusion
- evidence-preserving reduction
- 必要且經驗證的輕量 compaction
- 避免 parent context 全量複製
- worker result handle / evidence reference

這些機制應服務於：

> **減少昂貴模型與 worker 的重複 token 消耗**

而不是建立第二套 orchestration hierarchy。

## Context 原則

Worker 預設應取得：
```text
task
constraints
approved sources
expected output
acceptance criteria
必要 evidence references
```

而不是：
```text
完整 parent conversation
完整 reasoning history
所有 tool outputs
整個主代理 session
```

需要額外資訊時，優先 selective retrieval，而不是 full-context cloning。

Worker 回主腦也應優先：
```text
result
evidence
artifact refs
verification
unresolved issues
```

不要無條件回灌完整 worker transcript 與大型 tool output。

## 最終架構原則
```text
強模型負責「想、拆、判斷、驗收」

K Harness 負責「派工與資訊邊界」

Pi / cheap workers 負責「做」
```

不要讓 worker 層重新變成另一個主腦平臺。

