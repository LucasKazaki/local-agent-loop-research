# Local specialist loops: architecture landscape

Research snapshot: 2026-08-23. This memo uses first-party engineering posts, official documentation, repositories, and papers. Statements labeled **inference** are recommendations derived from those sources rather than claims made by the source authors.

## Answer first

A slow local specialist loop can outperform one local-model pass on decomposable, tool-grounded work. It does not reliably turn a 7B–20B model into a general Sol/Terra equivalent merely by adding more conversation. The useful extra intelligence comes from fresh context, independent candidate generation, environmental feedback, deterministic tests, durable memory, and a different-family critic. Repeated same-model agreement without new evidence compounds errors.

The best fit for this machine is a deterministic outer state machine with bounded model calls:

```text
goal + immutable constraints
          |
  SQLite task/evidence ledger
          |
 planner/router (strongest local model)
          |
  bounded task DAG + narrow tools
    /          |          \
researcher   coder      extractor
read-only   one writer   schema-bound
    \          |          /
      typed artifacts + receipts
          |
 deterministic verifier (tests/schema/citations)
          |
 independent critic -> accept or one bounded repair
```

The controller—not an LLM—owns retries, leases, fencing, task dependencies, approval gates, and stopping. Each worker gets a small task envelope and returns evidence/artifact references, not a transcript.

## What established systems are doing

| System | First-party pattern | Transferable lesson |
|---|---|---|
| [Anthropic multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system) (2025-06-13) | A lead agent persists a plan, fans out independent research workers, checks coverage, and routes the draft through a citation agent. Anthropic reports a 90.2% improvement over single Opus on an internal breadth-heavy research evaluation at roughly 15× chat-token use. | Parallelize independent breadth, compress worker findings, and verify citations separately. This is not evidence for dependency-heavy coding or general model parity. |
| [Anthropic long-running harness](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) (2025-11-26) | An initializer creates executable setup, a structured feature ledger, progress state, and a commit; each fresh session implements and tests one feature before handing off. | Files, tests, and Git are stronger cross-session memory than chat summaries. Start requirements as failing and prove them one by one. |
| [Anthropic parallel compiler experiment](https://www.anthropic.com/engineering/building-c-compiler) (2026-02-05) | Sixteen fresh-container agents used isolated clones, lock files, strong tests, concise tool output, and specialist roles. | Swarms work when tasks partition cleanly and the oracle is excellent. Isolate writers and use locks; do not generalize the result to uncontrolled local-agent debate. |
| [OpenAI agent orchestration](https://developers.openai.com/api/docs/guides/agents/orchestration) and [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) | A manager can own the final answer and call narrow agents as tools, or hand control to a specialist. Current guidance recommends adding agents for meaningful instruction, tool, policy, or context isolation and favors parallelism for read-heavy work. | Keep one final owner, narrow worker contracts, and avoid concurrent writers. Use the strongest model only at high-judgment nodes. |
| [Microsoft Magentic-One](https://www.microsoft.com/en-us/research/publication/magentic-one-a-generalist-multi-agent-system-for-solving-complex-tasks/) and [Agent Framework](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/) | A manager persists task, facts, plan, rounds, and stalls while specialists own web, file, terminal, and code work. Microsoft now directs new builds toward Agent Framework; [AutoGen is in maintenance mode](https://github.com/microsoft/autogen). | Persist a compact execution ledger with an explicit stall count. More overlapping agents/tools can increase routing errors. |
| [Google ADK graph workflows](https://adk.dev/graphs/) and [workflow agents](https://adk.dev/agents/workflow-agents/) | Static/programmatic graphs combine deterministic functions, tools, human nodes, and LLM judgment nodes; sequential, parallel, and loop templates are explicit. | Put known control flow in code. Local OpenAI-compatible endpoints belong at judgment nodes, not in control-plane logic. |
| [Google A2A](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/) | Agent Cards support discovery; durable Tasks produce Artifacts without shared implementation or memory. | A2A is an interoperability boundary, not an intelligence amplifier. Use it only when specialists become separately hosted services. |
| [LangGraph subagents](https://docs.langchain.com/oss/python/langchain/multi-agent/subagents) and [persistence](https://docs.langchain.com/oss/python/langgraph/persistence) | A manager calls fresh stateless workers; checkpoints and cross-thread stores are separate. The docs favor a small static specialist set and progressive discovery at larger scale. | LangGraph is a strong reference for local SQLite checkpoints, isolated workers, resumability, and inspectable routing. |
| [CrewAI processes](https://docs.crewai.com/v1.15.17/en/concepts/processes) and [Flows](https://docs.crewai.com/v1.15.17/en/concepts/flows) | Crews collaborate sequentially or hierarchically; Flows provide event routing, typed state, persistence, resume/fork, and usage accounting. | If used, make a Flow the reliable outer controller and call bounded Crews within nodes. |
| [MetaGPT](https://github.com/FoundationAgents/MetaGPT) | Product, architecture, project-management, and engineering roles exchange explicit artifacts through SOPs. | The useful unit is an artifact pipeline with role contracts—not a company metaphor by itself. |
| [ChatDev](https://github.com/OpenBMB/ChatDev) and its [evolving-orchestration paper](https://arxiv.org/abs/2505.19591) | The project moved toward configurable workflows; its research finds compact cyclic structures under a central orchestrator. | Prefer small planner–worker–critic cycles selected dynamically over all-to-all group chat. |
| [AFlow](https://proceedings.iclr.cc/paper_files/paper/2025/hash/5492ecbce4439401798dcd2c90be94cd-Abstract-Conference.html) | Workflow topology is searched with evaluation feedback; the paper reports task-specific gains and cases where smaller models beat GPT-4o at much lower inference cost. | Optimize routing/workflow against a held-out local evaluation suite. Do not treat task-specific wins as general small-model superiority. |
| [SWE-agent ACI](https://github.com/SWE-agent/SWE-agent/blob/main/docs/background/aci.md) | Small bounded file views, concise search, syntax-rejecting edits, isolated execution, and full trajectories shape the agent interface. | Better tools and feedback can matter more than another debating model. |
| [OpenHands SDK](https://docs.openhands.dev/sdk/index) and [local-model guide](https://github.com/OpenHands/docs/blob/main/openhands/usage/llms/local-llms.mdx) | Agent, event stream, tools, and workspace are separated; local models need direct tool-reliability testing and substantial context. | Use OpenHands as an isolated coding worker, not the global controller. Its strongest current local recommendations exceed this machine's easy single-GPU capacity. |
| [Aider architect/editor mode](https://aider.chat/docs/usage/modes.html), [repo map](https://aider.chat/docs/repomap.html), and [lint/test loop](https://aider.chat/docs/usage/lint-test.html) | Reasoning and editing are separate passes, repository context is graph-ranked into a budget, and deterministic lint/tests drive repair. | Benchmark edit protocol and map size per model. Aider is a promising bounded coding worker. |
| [Ralph](https://ghuntley.com/ralph/) | One task per fresh context, specifications and progress on disk, commits, and tests/static analysis as backpressure. | Fresh context plus filesystem memory helps, but existing codebases need bounded iterations and conservative permissions. |

## What independent builders are trying

- Geoffrey Huntley's [Ralph](https://ghuntley.com/ralph/) reduces the idea to repeated fresh agent sessions against a durable specification, progress file, repository state, and external checks. The transferable part is not an infinite chat loop; it is stateless attempts plus state and backpressure outside the model.
- Steve Yegge's [Gas Town](https://steve-yegge.medium.com/welcome-to-gas-town-4f25ee16dd04) and current [Gas City repository](https://github.com/gastownhall/gascity) treat sessions as replaceable workers while identities, tasks, messages, and history persist in a Git-backed work graph. Its dedicated roles, worktrees, health patrols, and visible orchestration are useful references. Its own author describes substantial operational risk and manual steering, so this project adopts the durable work plane and isolation ideas, not its high-concurrency default.
- Simon Willison's [parallel-agent notes](https://simonwillison.net/tags/parallel-agents/) emphasize that subagents preserve the top-level agent's scarce context, while his reported lost-worktree experience is a practical warning: every local task must have a stable task ID, branch/worktree pointer, and artifact receipt before more workers are added.
- IndyDevDan's [public agent repositories](https://github.com/disler) layer reusable skills, narrow subagents, orchestration commands, hooks, and observability. The local transfer is to standardize specialist contracts and tool hooks, then reuse them across projects; prompt libraries alone are not evidence that a model can perform the role.

**Inference:** these individual practices converge with the company systems on the same useful substrate: durable work items, replaceable sessions, narrow roles, isolated write ownership, external verification, and observability. They differ mainly in scale and interface. For two 8 GB GPUs, a small queue of two resident specialists plus time-sliced escalation is safer and more testable than a ten-agent swarm.

## Recommended deliberation policy

- Easy: one specialist → deterministic verifier.
- Medium: planner → specialist → verifier → at most one corrected retry.
- Hard: 2–3 independent plans → different-family critic → one selected worker → deterministic checks → at most two repair cycles.
- Research: source partitions → coverage/gap check → citation validator → synthesis.
- Coding: read-only exploration may fan out; one writer per branch/worktree; independent review only after a stable diff exists.

Stop on acceptance, repeated unchanged failure, no measurable improvement, an iteration/resource cap, or a real human gate. Never use an infinite conversational bounce.

## State and contracts

Persist this outside model context:

```text
goal, immutable_constraints, plan_version, facts_with_provenance,
tasks, dependencies, owners, artifacts, test_results, attempts,
rounds, stalls, status, next_action
```

Each worker receives:

```text
task_id, role, objective, relevant artifacts, allowed paths/tools,
immutable constraints, acceptance tests, budget, required output schema
```

Each response is schema-validated. Semantic correctness is then checked separately: right tool, right arguments, supported claims, test outcome, and correct stopping behavior.

## Safety boundary

[Anthropic's 2026 AI-organizations research](https://alignment.anthropic.com/2026/ai-organizations/) found that teams can become more capable while losing system-level alignment. Single-agent safety results do not certify a team. Keep original constraints visible to a top-level policy verifier, give specialists least-privilege tools, and require deterministic gates for side effects.

## What would justify “frontier-like”

Compare on held-out, representative project tasks:

1. Strongest single local model.
2. Single model with tools/retrieval.
3. Planner–worker.
4. Planner–worker–verifier.
5. Best-of-N plus judge.
6. Full specialist loop.

Run 3–5 repetitions for nondeterministic tasks and record exact task pass rate, constraint retention, tool/schema success, citation precision, productive versus stalled rounds, wall time, token counts, VRAM/RAM, prompt/config/model hashes, and artifact hashes. A matched Sol/Terra run is still required before making a parity claim.
