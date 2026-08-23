# Local specialist loop operating playbook

Research snapshot: 2026-08-23. This document specifies an implementable operating protocol for slow, all-local specialist loops. It is intentionally model-agnostic: role assignments must come from this project's measured local benchmark manifest rather than vendor rankings.

## Evidence labels

- **Measured externally** means the linked first-party team reported an empirical result. It does not mean that result has been reproduced on this PC.
- **Observed locally** means a result was reproduced by this project's benchmark harness on the RTX 3070 + GTX 1080 machine. No orchestration result in this playbook has that label yet.
- **Proposed** means an engineering design or default derived from the cited evidence. It must be tested locally before being described as better.
- **Required** means a safety or protocol invariant of this design, not a claim that every cited framework requires it.

The distinction matters. Anthropic measured a 90.2% improvement for its multi-agent research system over a single-agent baseline on an internal breadth-heavy research evaluation, while also observing roughly 15 times normal chat token use and warning that dependency-heavy coding is a poorer fit. That is **measured externally** for one research system, not evidence that local loops generally match frontier agents. See [Anthropic's multi-agent research report](https://www.anthropic.com/engineering/multi-agent-research-system).

## Operating position

**Proposed:** use a deterministic controller around small, bounded LLM roles. The controller owns state, permissions, retries, model selection, leases, approvals, and stopping. Models may propose work and artifacts; they may not decide whether their own result is accepted, expand their own permissions, or silently extend their budget.

```text
immutable request + policy
           |
  deterministic intake/classifier
           |
  task ledger + artifact/evidence store
           |
  strongest eligible local planner
           |
     bounded task graph
      /      |       \
 research  coding   extraction/vision
 read-only one writer schema-constrained
      \      |       /
       typed result envelopes
           |
 deterministic verification
           |
 independent critic when warranted
           |
 accept | bounded repair | stop/escalate
           |
 final synthesizer + durable closeout
```

This follows several independently documented patterns:

- Anthropic persists plans and compresses independent worker findings before synthesis; its long-running harness uses fresh sessions, a structured feature ledger, progress files, tests, and Git. [Research system](https://www.anthropic.com/engineering/multi-agent-research-system), [long-running harness](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- OpenAI distinguishes manager-owned agents-as-tools from handoffs and recommends adding specialists for meaningful instruction, tool, policy, or context isolation. [Agent orchestration](https://developers.openai.com/api/docs/guides/agents/orchestration), [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- Magentic-One records task, facts, plan, round count, and stall count; Microsoft Agent Framework exposes explicit sequential, concurrent, handoff, group-chat, and Magentic manager patterns. [Magentic-One](https://www.microsoft.com/en-us/research/publication/magentic-one-a-generalist-multi-agent-system-for-solving-complex-tasks/), [Agent Framework orchestrations](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/)
- Google ADK and LangGraph put deterministic routing, branching, state, and persistence around model nodes. [ADK graph workflows](https://adk.dev/graphs/), [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence)

## 1. Controller invariants

The following are **required**.

1. The controller is ordinary code. An LLM never owns the event loop.
2. Every run, task, attempt, artifact, evidence item, tool call, approval, and state transition has a stable identifier.
3. State changes are append-only events plus a materialized current view. Never rely on chat history as the system of record.
4. Every attempt receives an immutable task envelope. Any change to objective, constraints, permissions, or acceptance criteria creates a new envelope version.
5. Every model response is schema-validated before it can affect task state.
6. Acceptance is determined by controller-run checks, not by the producing worker's self-report.
7. Side effects use propose, authorize, execute, and verify phases. Planning text never directly becomes an action.
8. Permissions are least privilege and attempt-scoped. A retry does not inherit broader access.
9. One writer owns a repository/worktree at a time. Parallel agents are read-only unless their write sets are proven disjoint and isolated.
10. Retries, model calls, tool calls, wall time, and artifact size are bounded before execution starts.
11. Repeating an unchanged failure is a stall, not progress.
12. The original user goal, immutable constraints, and safety policy are supplied to the final policy/requirements gate even when specialists receive narrower context.
13. A worker cannot mark its own task `accepted`, alter a verifier, delete acceptance tests, or edit the run ledger directly.
14. The controller can always cancel a run and revoke a lease without waiting for another model turn.

Anthropic's 2026 AI-organization experiments found that specialist teams could improve task effectiveness while losing system-level ethical attention because individual roles focused on their subproblem. This is **measured externally** and motivates invariants 7, 8, and 12. [AI Organizations Can Be More Effective but Less Aligned than Individual Agents](https://alignment.anthropic.com/2026/ai-organizations/)

## 2. Durable state model

### 2.1 Run state

**Proposed:** persist the following logical object in SQLite. JSON is shown as an interface contract, not a storage requirement.

```json
{
  "protocol_version": "local-loop/1.0",
  "run_id": "run_...",
  "created_at": "RFC3339 timestamp",
  "updated_at": "RFC3339 timestamp",
  "request": {
    "raw_text_artifact_id": "artifact_...",
    "goal": "normalized desired outcome",
    "immutable_constraints": ["constraint"],
    "deliverables": ["deliverable"],
    "out_of_scope": ["boundary"],
    "approval_policy": "local_safe | confirm_side_effects | supervised",
    "deadline": null
  },
  "classification": {
    "task_family": "research | code_read | code_write | extraction | reasoning | vision | action | mixed",
    "difficulty": "easy | medium | hard",
    "verifiability": "strong | partial | weak",
    "dependency_shape": "independent | staged | tightly_coupled",
    "side_effect_risk": "none | local_reversible | external_reversible | irreversible",
    "data_sensitivity": "public | workspace | confidential | secret",
    "parallelism": "none | read_only | isolated_writes"
  },
  "plan": {
    "plan_version": 1,
    "planner_attempt_id": "attempt_...",
    "task_ids": ["task_..."],
    "assumptions": ["explicit assumption"],
    "open_questions": ["question"]
  },
  "budgets": {
    "max_wall_seconds": 3600,
    "max_model_calls": 20,
    "max_tool_calls": 100,
    "max_total_input_tokens": 200000,
    "max_total_output_tokens": 50000,
    "max_attempts": 12,
    "max_artifact_bytes": 1000000000
  },
  "usage": {
    "wall_seconds": 0,
    "model_calls": 0,
    "tool_calls": 0,
    "input_tokens": 0,
    "output_tokens": 0,
    "attempts": 0
  },
  "progress": {
    "accepted_tasks": 0,
    "total_tasks": 0,
    "rounds": 0,
    "stalls": 0,
    "last_progress_event_id": null,
    "last_progress_score": 0.0
  },
  "status": "created | classified | planned | running | awaiting_approval | blocked | succeeded | failed | cancelled",
  "stop_reason": null,
  "final_artifact_ids": [],
  "event_head": "event_..."
}
```

### 2.2 Task state

```json
{
  "task_id": "task_...",
  "run_id": "run_...",
  "task_version": 1,
  "parent_task_id": null,
  "title": "short stable title",
  "objective": "one testable outcome",
  "role": "planner | researcher | coder | extractor | vision | verifier | critic | synthesizer | policy_guard",
  "dependencies": ["task_id"],
  "priority": 50,
  "write_scope": [],
  "required_artifact_ids": [],
  "acceptance_check_ids": ["check_..."],
  "attempt_count": 0,
  "max_attempts": 2,
  "round_count": 0,
  "stall_count": 0,
  "failure_signatures": [],
  "lease": null,
  "status": "draft | ready | leased | running | verifying | repairable | accepted | blocked | failed | cancelled",
  "accepted_attempt_id": null,
  "blocked_reason": null
}
```

### 2.3 Lease and fencing token

Every mutating task must acquire a controller-issued lease:

```json
{
  "lease_id": "lease_...",
  "task_id": "task_...",
  "attempt_id": "attempt_...",
  "owner": "worker_instance_id",
  "fencing_token": 17,
  "write_scope": ["absolute path or isolated worktree id"],
  "issued_at": "RFC3339 timestamp",
  "expires_at": "RFC3339 timestamp"
}
```

**Required:** every write broker call includes the current fencing token. A stale or revoked worker is rejected even if its process is still running. Lease expiry moves the attempt to `interrupted`; it does not automatically authorize a retry until the controller inspects possible partial effects.

### 2.4 Artifact and evidence records

Artifacts and evidence are separate. An artifact is produced data; evidence supports a claim.

```json
{
  "artifact_id": "artifact_...",
  "run_id": "run_...",
  "task_id": "task_...",
  "attempt_id": "attempt_...",
  "kind": "plan | source_snapshot | note | patch | file | report | test_log | trace | model_output",
  "uri": "workspace-relative path or content-addressed URI",
  "sha256": "hex digest",
  "media_type": "text/markdown",
  "bytes": 1234,
  "created_at": "RFC3339 timestamp",
  "producer": "role/model/tool identity",
  "immutable": true
}
```

```json
{
  "evidence_id": "evidence_...",
  "claim_id": "claim_...",
  "source_artifact_id": "artifact_...",
  "source_url": null,
  "locator": "line, page, test name, command receipt, or JSON path",
  "support": "supports | contradicts | contextual",
  "extracted_statement": "short paraphrase",
  "retrieved_at": "RFC3339 timestamp",
  "content_sha256": "hex digest"
}
```

### 2.5 Suggested SQLite tables

**Proposed:** `runs`, `tasks`, `attempts`, `leases`, `artifacts`, `claims`, `evidence`, `checks`, `check_results`, `tool_receipts`, `approvals`, `events`, `model_profiles`, and `benchmark_snapshots`.

Use foreign keys, unique `(task_id, attempt_number)`, unique fencing tokens per task, and transactions for all state transitions. `events` is append-only; materialized rows may be rebuilt from it.

LangGraph formally separates thread checkpoints from cross-thread stores, while CrewAI Flows documents typed state, SQLite persistence, resume, and fork behavior. These are **documented capabilities**, not local measurements. [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence), [CrewAI Flows](https://docs.crewai.com/v1.15.17/en/concepts/flows)

## 3. Legal state transitions

### 3.1 Run transitions

| From | To | Guard |
|---|---|---|
| `created` | `classified` | Classification schema valid; immutable request artifact stored. |
| `classified` | `planned` | Plan is acyclic, every task has acceptance checks, aggregate budget fits run budget. |
| `planned` | `running` | All initially ready tasks resolved to eligible role/model profiles. |
| `running` | `awaiting_approval` | An action requires authority not present in the run policy. |
| `awaiting_approval` | `running` | Approval receipt matches exact action hash and has not expired. |
| `running` | `blocked` | Progress is impossible without new input/capability and no safe alternative exists. |
| `running` | `succeeded` | Every required task is accepted; final policy and deliverable checks pass. |
| Any nonterminal | `failed` | Hard stop condition fires or required task is terminally failed. |
| Any nonterminal | `cancelled` | User/controller cancellation; all leases revoked. |

Terminal states are immutable except for a separately recorded administrative annotation. Resuming a blocked or failed run creates a new run linked by `resumes_run_id` so its changed assumptions and budgets remain auditable.

### 3.2 Task transitions

| From | To | Guard |
|---|---|---|
| `draft` | `ready` | Dependencies and acceptance contract validate. |
| `ready` | `leased` | Eligible worker/model and permission set found; lease issued. |
| `leased` | `running` | Worker acknowledges the exact envelope hash. |
| `running` | `verifying` | Result envelope validates and referenced artifacts exist with matching hashes. |
| `verifying` | `accepted` | All hard checks pass and any soft-score threshold is met. |
| `verifying` | `repairable` | Failure is actionable, safe, within budget, and a retry would change at least one controlled variable. |
| `repairable` | `ready` | New attempt envelope includes verifier feedback and a retry strategy. |
| Any nonterminal | `blocked` | Missing required input, capability, or approval. |
| Any nonterminal | `failed` | Nonrepairable verifier failure, repeated failure signature, budget exhaustion, or safety stop. |
| Any nonterminal | `cancelled` | Parent/run cancellation; lease revoked. |

No transition may skip `verifying`. A parser-valid model response is not a verified result.

## 4. Role graph and authority

### 4.1 Role definitions

| Role | Purpose | Default access | May create tasks? | May accept work? |
|---|---|---|---|---|
| Controller | State machine, scheduling, budgets, leases, authorization, stop logic | Ledger and brokers | Deterministically | Yes, only from check results |
| Intake normalizer | Convert user request into goal, deliverables, constraints, ambiguity list | Request read-only | No | No |
| Classifier | Assign family, difficulty, verifiability, dependency, risk, and parallelism | Metadata/read-only | No | No |
| Planner | Produce bounded DAG, assumptions, acceptance checks, and artifact flow | Read-only workspace/evidence | Proposes only | No |
| Researcher | Gather and compress evidence for an assigned partition | Read-only files/network when allowed | Proposes follow-up | No |
| Extractor | Transform bounded input into a required schema | Read-only input | No | No |
| Vision specialist | Inspect supplied images/screenshots/doc pages | Read-only media | Proposes follow-up | No |
| Coder | Produce a patch in an isolated worktree | Leased write scope; sandboxed shell | Proposes follow-up | No |
| Verifier | Run deterministic checks and emit check receipts | Read-only plus test execution | No | Recommends only |
| Critic | Search for requirement, security, factual, or design failures not covered by deterministic checks | Read-only result and original constraints | Proposes repair | No |
| Synthesizer | Assemble accepted artifacts into the requested output | Accepted artifacts only | No | No |
| Policy/requirements guard | Compare proposed final output/action with original request, constraints, approvals, and risk policy | Original request + final artifacts | No | Can veto, not waive policy |

**Required:** model-facing roles are logical profiles, not hard-coded model names. The runtime resolves a role to an eligible local model from a versioned benchmark manifest.

```json
{
  "profile_id": "local-code-writer-v3",
  "benchmark_snapshot_id": "bench_...",
  "eligible_models": [
    {
      "model_id": "exact local artifact id",
      "quantization": "exact quant",
      "template_hash": "sha256",
      "runtime": "llama.cpp server id",
      "gpu_affinity": [0, 1],
      "context_limit": 8192,
      "measured_scores": {
        "role_score": 0.0,
        "tool_semantic_success": 0.0,
        "schema_success": 0.0,
        "median_seconds": 0.0
      }
    }
  ],
  "minimum_thresholds": {
    "role_score": 0.70,
    "schema_success": 0.95
  }
}
```

The numeric thresholds above are **proposed placeholders**. They must be replaced by project policy after local measurements exist. A model that fails the minimum for a role is ineligible even if it is the largest installed model.

### 4.2 Default graph

```text
INTAKE -> CLASSIFY -> PLAN -> VALIDATE_PLAN
                               |
                +--------------+--------------+
                |              |              |
             RESEARCH       CODE_READ      EXTRACT/VISION
                |              |              |
                +-------> PLAN_UPDATE <-------+
                               |
                         CODE_WRITE/ACTION
                               |
                         VERIFY_HARD_CHECKS
                               |
                  +------------+------------+
                  |                         |
                pass                     repairable
                  |                         |
           CRITIC_IF_NEEDED <----- bounded repair loop
                  |
           POLICY/REQUIREMENTS_GATE
                  |
              SYNTHESIZE -> CLOSE
```

Parallel branches are legal only if dependencies do not cross and their capabilities are read-only or their write scopes are isolated. Anthropic's compiler experiment used separate clones and task locks, and explicitly emphasized test quality and concise feedback. That is **measured externally in a frontier-model experiment**, not yet locally reproduced. [Parallel compiler experiment](https://www.anthropic.com/engineering/building-c-compiler)

## 5. Task classification and routing

### 5.1 Classification axes

The controller applies deterministic rules first. An LLM classifier may fill genuinely semantic gaps, but its output must conform to the same enum and cannot lower side-effect risk assigned by deterministic inspection.

#### Task family

- `research`: evidence collection or comparison across sources.
- `code_read`: repository discovery, diagnosis, dependency mapping, or review without edits.
- `code_write`: patching, refactoring, generating code, or changing tests/configuration.
- `extraction`: bounded transformation into a known schema.
- `reasoning`: planning, design selection, proof, or trade-off analysis.
- `vision`: image, screenshot, diagram, scanned document, or UI inspection.
- `action`: side effect outside artifact production, including publication, messaging, deployment, purchase, deletion, or account change.
- `mixed`: must be decomposed until child tasks have a primary family.

#### Difficulty

- `easy`: one narrow outcome, supplied context, one tool domain, strong deterministic verifier, expected in one worker call.
- `medium`: multiple files/sources or one meaningful ambiguity, staged work, partial deterministic checks, expected in a plan plus one worker call.
- `hard`: unclear decomposition, long horizon, tightly coupled dependencies, weak verifier, safety-critical judgment, or evidence exceeding one context. Requires explicit plan comparison or human gate.

#### Verifiability

- `strong`: exact schema, unit/integration tests, compiler, checksum, reproducible query, or direct source locator.
- `partial`: rubric plus some deterministic checks.
- `weak`: primarily aesthetic, strategic, or open-ended judgment. More agents do not turn weak verification into ground truth.

#### Side-effect risk

- `none`: read-only reasoning or artifact creation in an isolated scratch area.
- `local_reversible`: edits under an authorized worktree with recoverable version control.
- `external_reversible`: remote publication/change with a demonstrated rollback path.
- `irreversible`: deletion, financial/legal commitment, secret disclosure, or action without reliable rollback.

### 5.2 Routing table

| Condition | Required route |
|---|---|
| Easy + strong verification + no side effect | One specialist, then deterministic verifier. No planner LLM unless classification confidence is low. |
| Medium + strong/partial verification | Planner → one specialist → verifier → at most one repair attempt. |
| Hard + decomposable + read-only | Two or three independent plan/research branches → critic/judge → staged execution. |
| Hard + tightly coupled | Strongest eligible planner, sequential tasks, checkpoint after every accepted artifact; no swarm. |
| Research breadth with independent partitions | Fan out by mutually exclusive source/topic partitions, then coverage check and citation validator. |
| Code write | Read-only exploration may fan out; one leased writer per worktree; deterministic tests before critic. |
| Weak verification | Human review or explicit rubric gate before final acceptance; never use model consensus alone. |
| External reversible action | Generate action proposal and preview; exact-hash approval; execute once; independently verify remote state. |
| Irreversible action | Stop for explicit user authority and a dedicated safety review. No autonomous retry. |
| Secret-bearing input | Use secret broker/tool references; never place plaintext secrets in a model envelope or persisted trace. |

Anthropic's foundational agent guidance describes prompt chaining, routing, parallel sectioning/voting, orchestrator-workers, and evaluator-optimizer as different fits, while advising that complexity be added only when evaluation shows value. This is **first-party guidance**, not a local performance measurement. [Building Effective AI Agents](https://www.anthropic.com/engineering/building-effective-agents)

### 5.3 Deterministic routing pseudocode

```python
def route(task):
    if task.side_effect_risk == "irreversible":
        return ["policy_guard", "human_approval"]

    if task.side_effect_risk == "external_reversible":
        return ["planner", "policy_guard", "human_approval", "executor", "verifier"]

    if task.verifiability == "weak":
        return ["planner", "specialist", "critic", "human_or_rubric_gate"]

    if task.task_family == "code_write":
        return ["code_read", "coder_single_writer", "verifier", "critic_if_hard"]

    if task.difficulty == "easy":
        return ["specialist", "verifier"]

    if task.difficulty == "medium":
        return ["planner", "specialist", "verifier", "repair_at_most_once"]

    if task.dependency_shape == "independent":
        return ["independent_candidates_2_or_3", "critic_judge", "verifier"]

    return ["strongest_planner", "sequential_specialists", "verifier", "bounded_repairs"]
```

## 6. Worker protocol

### 6.1 Task envelope

The controller sends exactly one envelope per attempt. Referenced artifacts are content-addressed; the envelope contains no inherited free-form transcript.

```json
{
  "protocol_version": "local-loop/1.0",
  "envelope_type": "task",
  "run_id": "run_...",
  "task_id": "task_...",
  "task_version": 1,
  "attempt_id": "attempt_...",
  "attempt_number": 1,
  "envelope_sha256": "hex digest",
  "role": "researcher",
  "model_profile": "local-research-v2",
  "objective": "One observable outcome stated as an imperative",
  "why_this_task_exists": "One or two sentences connecting it to the parent goal",
  "immutable_constraints": ["constraint"],
  "assumptions_allowed": ["explicit assumption"],
  "inputs": [
    {
      "artifact_id": "artifact_...",
      "sha256": "hex digest",
      "purpose": "why this input is relevant",
      "required": true
    }
  ],
  "capabilities": {
    "tools": ["namespaced.read_file", "namespaced.search"],
    "network": "none | allowlisted | unrestricted_read",
    "read_paths": ["absolute allowed path"],
    "write_paths": [],
    "shell": "none | sandboxed_read | sandboxed_write",
    "lease": null
  },
  "acceptance": {
    "hard_checks": [
      {
        "check_id": "check_...",
        "type": "schema | command | test | citation | hash | policy",
        "specification": "machine-readable or exact command reference"
      }
    ],
    "soft_rubric_id": null,
    "minimum_soft_score": null
  },
  "budget": {
    "deadline": "RFC3339 timestamp",
    "max_wall_seconds": 600,
    "max_model_output_tokens": 4000,
    "max_tool_calls": 15,
    "max_artifact_bytes": 10000000
  },
  "output_contract": {
    "schema_id": "result-envelope/1.0",
    "required_artifact_kinds": ["note"],
    "must_report_unresolved": true,
    "must_include_evidence_for_claims": true
  },
  "retry_context": null
}
```

### 6.2 Result envelope

```json
{
  "protocol_version": "local-loop/1.0",
  "envelope_type": "result",
  "run_id": "run_...",
  "task_id": "task_...",
  "task_version": 1,
  "attempt_id": "attempt_...",
  "acknowledged_task_envelope_sha256": "hex digest",
  "status": "completed | blocked | failed",
  "summary": "concise result, not hidden reasoning",
  "artifacts": [
    {
      "artifact_id": "artifact_...",
      "kind": "note | patch | file | report | test_log",
      "uri": "workspace-relative or broker URI",
      "sha256": "hex digest",
      "media_type": "text/markdown",
      "bytes": 1234
    }
  ],
  "claims": [
    {
      "claim_id": "claim_...",
      "statement": "verifiable claim",
      "confidence": "high | medium | low",
      "evidence_ids": ["evidence_..."]
    }
  ],
  "evidence": [
    {
      "evidence_id": "evidence_...",
      "source_artifact_id": "artifact_...",
      "source_url": null,
      "locator": "exact locator",
      "support": "supports | contradicts | contextual"
    }
  ],
  "tool_receipt_ids": ["receipt_..."],
  "checks_run_by_worker": [
    {
      "name": "informational only",
      "status": "pass | fail",
      "receipt_id": "receipt_..."
    }
  ],
  "changed_scope": ["path or external object id"],
  "unresolved": ["remaining uncertainty, missing input, or risk"],
  "proposed_followups": [
    {
      "objective": "possible next task",
      "reason": "why it may be needed"
    }
  ],
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0,
    "tool_calls": 0,
    "wall_seconds": 0
  },
  "failure": null
}
```

Worker-run checks are advisory. The verifier reruns acceptance checks from a clean or controlled state.

### 6.3 Failure object

```json
{
  "category": "transient_runtime | schema | tool_protocol | capability | semantic | verifier | policy | interrupted",
  "message": "short actionable description",
  "failure_signature": "sha256(normalized category + failing check + salient error)",
  "retryable": true,
  "recommended_change": "model | prompt | context | tool | plan | none",
  "partial_effect_receipt_ids": []
}
```

### 6.4 Verification envelope

```json
{
  "protocol_version": "local-loop/1.0",
  "envelope_type": "verification",
  "task_id": "task_...",
  "attempt_id": "attempt_...",
  "artifact_hashes_verified": true,
  "hard_checks": [
    {
      "check_id": "check_...",
      "status": "pass | fail | error",
      "receipt_id": "receipt_...",
      "failure_signature": null,
      "diagnostic_artifact_id": null
    }
  ],
  "soft_rubric": null,
  "policy_status": "pass | fail | not_applicable",
  "decision": "accept | repair | block | fail",
  "repair_brief": null
}
```

### 6.5 Repair envelope

A repair is a new attempt, not continuation chat. It includes the original immutable objective and constraints plus:

```json
{
  "prior_attempt_id": "attempt_...",
  "failed_check_ids": ["check_..."],
  "diagnostic_artifact_ids": ["artifact_..."],
  "prior_failure_signature": "hex digest",
  "required_strategy_change": "prompt | context | tool | model | decomposition | implementation",
  "forbidden_repetition": "description of unchanged failed approach"
}
```

LangChain's current subagent guidance explicitly recommends context isolation, concise final returns, carefully specified input/output context, and notes the common failure where a worker omits needed results from its final message. This is a **documented design pattern**. [LangChain subagents](https://docs.langchain.com/oss/python/langchain/multi-agent/subagents)

## 7. Tool protocol and side effects

### 7.1 Tool receipt

Every invocation returns a durable receipt even when output is empty.

```json
{
  "receipt_id": "receipt_...",
  "attempt_id": "attempt_...",
  "tool_name": "namespace.operation",
  "tool_version": "semver or hash",
  "argument_sha256": "hex digest",
  "started_at": "RFC3339 timestamp",
  "finished_at": "RFC3339 timestamp",
  "exit_status": "success | failure | denied | timeout | interrupted",
  "exit_code": 0,
  "stdout_artifact_id": "artifact_...",
  "stderr_artifact_id": "artifact_...",
  "effect_ids": [],
  "fencing_token": null
}
```

SWE-agent reports that syntax-rejecting edits, 100-line file views, concise search output, and explicit messages for successful commands with no output materially improve its agent-computer interface. This is **measured externally in SWE-agent's research/program**, not yet a local benchmark result. [SWE-agent ACI](https://github.com/SWE-agent/SWE-agent/blob/main/docs/background/aci.md)

**Proposed tool rules:**

- Return summaries in the model context and store verbose output as artifacts.
- Paginate or cap file/search/test output; expose exact artifact references for drill-down.
- Namespace every tool and avoid overlapping descriptions. Microsoft has documented tool-space interference where adding plausible tools can reduce performance. [Microsoft Research discussion](https://www.microsoft.com/en-us/research/publication/magentic-one-a-generalist-multi-agent-system-for-solving-complex-tasks/)
- Validate arguments in code. Grammar-valid JSON does not prove the selected tool or arguments are semantically correct.
- Make tools idempotent where possible and require idempotency keys for external actions.
- Never expose a broad shell when a narrow typed tool can perform the task.

### 7.2 Two-phase action protocol

For any external or material side effect:

1. `PROPOSE`: worker emits an action proposal with target, exact arguments, expected effects, risks, rollback, and idempotency key.
2. `AUTHORIZE`: controller checks scope/policy. Human approval is captured when required and binds to the proposal hash.
3. `EXECUTE`: a broker invokes the action exactly once with the approval and idempotency key.
4. `VERIFY`: a separate read operation confirms actual state and records an effect receipt.
5. `COMMIT` or `COMPENSATE`: controller closes the action or invokes the pre-authorized rollback.

```json
{
  "action_proposal_id": "action_...",
  "target": "stable external object or local absolute path",
  "operation": "typed operation",
  "arguments": {},
  "argument_sha256": "hex digest",
  "expected_effects": ["effect"],
  "risk": "local_reversible | external_reversible | irreversible",
  "rollback": {"operation": "typed rollback", "arguments": {}},
  "idempotency_key": "stable key",
  "required_approval": "none | user | administrator",
  "expires_at": "RFC3339 timestamp"
}
```

An approval never authorizes changed arguments, a different target, or an expired proposal.

## 8. Bounded retries and progress

### 8.1 Proposed defaults

These are **proposed starting values**, not measured optima.

| Class | Candidate/planner calls | Worker attempts | Critic calls | Default wall cap | Default tool-call cap |
|---|---:|---:|---:|---:|---:|
| Easy | 0 | 2 total | 0 | 10 min | 15 per attempt |
| Medium | 1 | 2 total | 0–1 | 30 min | 25 per attempt |
| Hard, decomposable/read-only | 2–3 independent candidates | 3 total | 1 per accepted candidate set | 90 min | 60 per attempt |
| Hard, tightly coupled/code write | 1 strongest planner | 3 total | 1 after deterministic checks | 120 min | 60 per attempt |
| External action | 1 proposal | 1 execution; no blind action retry | 1 policy review | Explicit deadline | Operation-specific |

### 8.2 Retry policy

| Failure category | Retry rule |
|---|---|
| `transient_runtime` | Retry same envelope once after runtime health check/backoff; do not count as semantic repair if no side effect occurred. |
| `schema` | One constrained regeneration or parser-compatible fallback. Second schema failure changes model/profile or fails task. |
| `tool_protocol` | Repair tool arguments once using validator diagnostics; repeated failure changes tool/model or stops. |
| `capability` | Do not repeat. Re-route to an eligible model/tool or block. |
| `semantic` | Retry only with new evidence, changed decomposition, changed context, changed model, or explicit verifier feedback. |
| `verifier` | If the verifier itself errored, repair verifier infrastructure separately. If work failed a valid check, issue a repair envelope. |
| `policy` | No autonomous retry designed to evade the policy. Stop or request explicit authority. |
| `interrupted` | Inspect receipts and workspace state before retry. Never assume no effect. |

### 8.3 Progress score

The controller records progress only from observable state:

```text
progress_score =
    accepted_required_checks / total_required_checks
  + 0.1 * accepted_optional_checks / max(1, total_optional_checks)
  - 0.05 * regression_count
  - 0.02 * repeated_failure_count
```

The weights are **proposed placeholders**. A domain may replace them, but a model may not set its own progress score.

A round is productive only if at least one occurs:

- A previously failing required check passes without another required regression.
- A required artifact is accepted.
- A blocking uncertainty is resolved with new evidence.
- A task is validly decomposed in a way that reduces estimated remaining work and passes plan validation.

Otherwise increment `stalls`. Two identical failure signatures or two nonproductive semantic rounds on the same task make it terminally stalled by default. A different model repeating the same failed action is still the same failure signature.

## 9. Acceptance, criticism, and synthesis

### 9.1 Acceptance order

1. Envelope schema and artifact hashes.
2. Permission/write-scope receipts.
3. Deterministic hard checks: build, tests, lint, schema, citations, query results, checksums.
4. Regression checks.
5. Soft rubric, only if necessary.
6. Independent critic for hard, safety-sensitive, weakly verified, or final-integrated work.
7. Policy/requirements gate against the original request.
8. Controller acceptance transaction.

The producing worker's confidence is metadata, never an acceptance signal.

### 9.2 Critic contract

The critic receives the original goal/constraints, accepted artifact candidate, check receipts, and an explicit defect taxonomy. It does not receive the producer's hidden reasoning or praise/defense of the result.

```json
{
  "candidate_artifact_ids": ["artifact_..."],
  "original_goal": "...",
  "immutable_constraints": ["..."],
  "check_result_ids": ["check_result_..."],
  "defect_classes": [
    "requirement_omission",
    "unsupported_claim",
    "security_or_policy",
    "regression",
    "interface_mismatch",
    "unhandled_edge_case",
    "premature_completion"
  ],
  "output": {
    "verdict": "pass | repair | reject | uncertain",
    "findings": [
      {
        "severity": "critical | high | medium | low",
        "defect_class": "enum",
        "locator": "artifact location",
        "evidence_id": "evidence_...",
        "required_fix": "testable correction"
      }
    ]
  }
}
```

Use a different model family from the producer when the local benchmark shows it is competent for the critic role. This is **proposed** to reduce correlated failure; it is not guaranteed to create independence.

### 9.3 Synthesis contract

The synthesizer can cite only accepted artifacts/evidence. It cannot silently repair rejected content. If synthesis discovers a material gap, it returns `blocked` with a proposed task rather than inventing missing facts.

Final closeout must store:

- Final deliverable artifacts and hashes.
- Exact accepted task/attempt IDs.
- Model, quantization, prompt/template, runtime, and benchmark snapshot IDs.
- All hard-check receipts.
- Known limitations and unresolved items.
- Aggregate resource usage.
- Stop reason.
- A short future-agent handoff that references canonical artifacts rather than restating them from memory.

## 10. Stop and escalation conditions

The controller stops immediately when any hard condition fires:

- User cancellation, deadline, or run budget is exhausted.
- A required check is nonrepairable.
- Maximum attempts or semantic stalls are reached.
- The same normalized failure signature occurs twice without an intervening accepted change.
- Required model/tool capability is unavailable or below the configured benchmark threshold.
- A worker requests paths, tools, network, or authority outside its envelope.
- An artifact hash, task version, lease, or fencing token does not match.
- Partial side effects cannot be reconciled safely.
- A policy check fails.
- An irreversible or externally material action lacks exact, current approval.
- Evidence needed for a factual claim cannot be obtained within scope.
- The plan is cyclic, exceeds budget, or contains tasks without acceptance checks.
- All deliverables pass and the policy/requirements gate approves; success is also a stop condition.

Escalation output must be actionable:

```json
{
  "run_id": "run_...",
  "status": "blocked | failed",
  "stop_reason_code": "stable enum",
  "summary": "what prevented safe completion",
  "completed_artifact_ids": [],
  "failed_check_ids": [],
  "last_failure_signature": null,
  "input_needed": "one precise decision/input, or null",
  "safe_options": [
    {"option": "A", "effect": "what changes", "risk": "..."}
  ],
  "unsafe_or_exhausted_options": ["what must not be repeated"]
}
```

## 11. Safety controls

### Required controls

- Default to read-only. Grant writes per absolute scope and per attempt.
- Run generated code and tests in an isolated container or constrained process, never directly on the unrestricted host by default.
- Use worktrees/clones and controller leases for code writers.
- Treat retrieved web pages, repository text, documents, tool output, and prior-agent notes as untrusted data. They cannot modify system policy, permissions, budgets, or acceptance rules.
- Separate secrets from prompts and traces. Agents receive opaque secret/tool handles only.
- Preserve the original request and constraints outside worker context and reapply them at the final gate.
- Require source locators and hashes for material factual claims.
- Require deterministic checks before LLM criticism so a persuasive critique cannot override failing tests.
- Never let an agent weaken, delete, or rewrite its own acceptance tests. Changes to tests are separate tasks reviewed against the original requirement.
- Log every denial and permission escalation request.
- Use explicit human approval for external publication, messaging, deployment, deletion, account changes, financial/legal action, or any irreversible operation.
- Re-verify actual state after every material side effect.

OpenHands separates the agent client/server from an isolated workspace, and SWE-agent defaults to sandboxed execution. These are **documented implementation patterns**. [OpenHands Agent Server architecture](https://docs.openhands.dev/sdk/guides/agent-server/overview), [SWE-agent hello world](https://github.com/SWE-agent/SWE-agent/blob/main/docs/usage/hello_world.md)

## 12. Context and memory policy

### Context layers

1. **Immutable policy layer:** original goal, constraints, scope, approval rules.
2. **Task layer:** current task envelope only.
3. **Evidence layer:** selected source/artifact excerpts with provenance.
4. **Execution layer:** recent tool receipts and bounded diagnostics.
5. **Durable memory layer:** accepted artifacts, decisions, and proven operational lessons outside the prompt.

Do not copy the full parent conversation into specialists. Anthropic describes subagents as separate context windows that compress findings, while LangChain explicitly treats same-capability subagents as useful for context isolation. These are **documented/measured external patterns**. [Anthropic research](https://www.anthropic.com/engineering/multi-agent-research-system), [LangChain subagents](https://docs.langchain.com/oss/python/langchain/multi-agent/subagents)

### Promotion to future-agent memory

A proposed lesson becomes durable guidance only when it has:

- A stable statement and scope.
- At least one supporting accepted run artifact.
- Reproduction count and benchmark snapshot.
- Known counterexamples/failure conditions.
- Review date and owner.

```json
{
  "memory_id": "memory_...",
  "statement": "operational lesson",
  "scope": "role/model/runtime/task family",
  "status": "candidate | validated | deprecated",
  "supporting_run_ids": [],
  "reproduction_count": 0,
  "counterexample_run_ids": [],
  "benchmark_snapshot_id": "bench_...",
  "reviewed_at": "RFC3339 timestamp",
  "expires_at": null
}
```

Raw model opinions are not memory. Failed trajectories may be retained for audit and demonstrations, but they are not automatically instructions.

## 13. Observability and local evaluation

Every attempt must record:

- Exact model artifact, quantization, template/prompt hash, runtime build, context/KV settings, GPU assignment, and random seed when available.
- Task/result envelope hashes.
- Tool receipts and artifact hashes.
- Verification and critic results.
- Input/output tokens or runtime-estimated equivalents.
- Prompt evaluation, generation, tool, queue, and total wall time.
- Peak VRAM/RAM and runtime failures.
- Productive rounds, stalls, and failure signatures.

SWE-agent stores thought/action/observation trajectories and exact configuration for reproducibility, and AFlow optimizes workflow structures against execution feedback. These are **documented external approaches**. [SWE-agent trajectories](https://github.com/SWE-agent/SWE-agent/blob/main/docs/usage/trajectories.md), [AFlow, ICLR 2025](https://proceedings.iclr.cc/paper_files/paper/2025/hash/5492ecbce4439401798dcd2c90be94cd-Abstract-Conference.html)

Before promoting this playbook from **proposed** to **observed locally**, compare on held-out tasks:

1. Strongest single local model.
2. Single local model with the same tools/retrieval.
3. Planner → worker.
4. Planner → worker → deterministic verifier.
5. Independent candidates → critic/judge.
6. Full protocol in this document.

Run at least three repetitions for nondeterministic tasks. Match task inputs, permissions, tool versions, acceptance checks, and maximum compute. Report task success, regression rate, constraint retention, tool semantic success, schema success, citation precision, wall time, total generation, peak memory, and stalls. A longer loop is better only if held-out acceptance improves enough to justify its additional time and compute.

## 14. Reference implementation order

**Proposed sequence:**

1. Implement envelope schemas, canonical JSON hashing, append-only events, and SQLite transactions.
2. Implement the run/task state machines and hard stop checks without any LLM.
3. Implement read-only artifact/evidence brokers and bounded tool receipts.
4. Add the role/model benchmark manifest and eligibility resolver.
5. Add one easy path: extractor or researcher → deterministic verifier.
6. Add isolated coding with lease/fencing, one worktree writer, and clean-state verification.
7. Add repair envelopes and failure-signature stall detection.
8. Add critic and synthesis roles.
9. Add two-phase external actions only after approvals and audit are tested.
10. Benchmark each added pattern against the simpler previous stage and retain it only if it improves held-out results.

This sequence keeps the intelligence layer replaceable. LangGraph, Google ADK, Microsoft Agent Framework, or CrewAI Flow could implement parts of the graph, but protocol and safety behavior must remain explicit and covered by project tests. Protocol correctness must not depend on a framework's conversational defaults.

## 15. Minimal success criteria for version 1

Version 1 is complete only when it can demonstrate all of the following locally:

- Resume a killed run from SQLite without replaying an accepted side effect.
- Reject a stale writer by fencing token.
- Reject a result with a mismatched envelope or artifact hash.
- Stop after repeated identical failure signatures.
- Keep two read-only specialists isolated and synthesize only their accepted artifacts.
- Allow exactly one code writer and rerun tests from a controlled state.
- Block an unapproved external action and execute an approved exact-hash mock action once.
- Preserve the original constraints through final synthesis.
- Produce a complete trace showing model/runtime versions, receipts, checks, artifacts, budgets, and stop reason.
- Show, on held-out tasks, whether the full loop improves over the strongest single-local-model baseline. A null or negative result is valid; claiming frontier parity without a matched frontier evaluation is not.
