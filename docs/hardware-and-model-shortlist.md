# Model shortlist for RTX 3070 8 GB + GTX 1080 8 GB

Research snapshot: 2026-08-23. Hardware observed on this machine: RTX 3070 8,192 MiB, GTX 1080 8,192 MiB, Ryzen 5 7600X, and 64 GB system RAM. LM Studio's catalog exposed twelve LLM/VLMs and one embedding model at audit time. Vendor benchmark numbers below are screening evidence, not directly comparable local results.

## Recommended operating modes

Nominal VRAM is not usable model capacity. Windows/display use, CUDA buffers, KV cache, and vision projectors mean approximately 12–13 GB is comfortable across both cards, 14–15 GB is borderline, and a model requiring a true 16 GB should be expected to spill into RAM.

1. **Resident specialist mode:** keep a 6–7 GB planner/reasoner on the 3070 and a 5–6 GB router/extractor on the 1080.
2. **Hard-task mode:** unload both, split one 10–13 GB coding/reasoning GGUF across both GPUs, save its artifact, then reload a different-family critic.
3. **Vision-on-demand:** do not keep vision projectors resident for text work. Load a VLM only for screenshots, documents, charts, or frames.
4. **Retrieval mode:** keep compact embeddings/reranking on CPU or the secondary GPU; retrieval should narrow context before expensive reasoning.

## First-priority candidates

| Model | Best candidate roles | Practical configuration | Evidence and caveats |
|---|---|---|---|
| [Gemma 4 12B](https://ai.google.dev/gemma/docs/core/model_card_4) | planner, reasoner, critic, coding, vision/document work | Google's official [QAT Q4_0 GGUF](https://huggingface.co/google/gemma-4-12B-it-qat-q4_0-gguf), about 6.7 GB; modest context on the 3070 | Strong fit for one GPU. Test normal Q4_K_M versus official QAT locally; vendor scores do not establish this quant's task performance. |
| [Qwen3.5-9B](https://huggingface.co/Qwen/Qwen3.5-9B) | tool executor, general synthesis, instruction following, multilingual work, optional vision | Q4_K_M is about 6.2 GB; omit the projector for text-only work | Official card reports strong instruction/tool benchmarks. Directly test tool choice, arguments, stopping, and JSON semantics. |
| [Devstral Small 2 24B](https://huggingface.co/mistralai/Devstral-Small-2-24B-Instruct-2512) | repository exploration and bounded code editing | Installed Q3_K_M is 11.47 GB; use a llama.cpp layer split across both GPUs for escalation | Purpose-trained for software-agent work. The local code suite and placement benchmark below supersede vendor ranking for routing on this PC. |
| [Granite 4.1 8B](https://huggingface.co/ibm-granite/granite-4.1-8b) | tool routing, grounding, JSON, RAG, evidence checking | Installed verified Q4_K_M is 5.35 GB and runs as a dedicated GTX 1080 llama.cpp endpoint | IBM documents native OpenAI-style tool definitions. Local tests found strong grounding and tool behavior but a hard failure on the generic critique task. |
| [GLM-4.6V-Flash](https://huggingface.co/zai-org/GLM-4.6V-Flash) | screenshots, UI/document inspection, vision-driven function calls | Installed Q4_K_M plus projector on demand | Its card warns about pure-text QA and repetition; keep it vision-specialized unless local tests disagree. |
| [Ministral 3 14B Reasoning](https://huggingface.co/mistralai/Ministral-3-14B-Reasoning-2512) | independent reasoning/vision/tool challenger | Q4_K_M around 8.2 GB or Q5_K_M around 9.6 GB split across both GPUs | Useful different-family critic; not a default until it beats compact resident models. |
| [Qwen3 Embedding 0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B) + [Qwen3 Reranker 0.6B](https://huggingface.co/Qwen/Qwen3-Reranker-0.6B) | local memory, document/code retrieval | CPU or GTX 1080; 32K input and instruction-aware queries | Preferred new retrieval pair. The installed Nomic v1.5 model remains a useful baseline. |

## Installed stretch and baseline models

- [gpt-oss-20b](https://huggingface.co/openai/gpt-oss-20b) is a useful reasoning/tool/structured-output baseline, but the official [Ollama guide](https://developers.openai.com/cookbook/articles/gpt-oss/run-locally-ollama) recommends at least 16 GB VRAM or unified memory. On this machine its 12.1 GB MXFP4 weights partially spill to RAM when LM Studio uses only the 3070. Runtime history also shows PEG-format failures, 8K context overruns, and long timeouts that must be measured separately from semantic quality.
- [Phi-4-mini-reasoning](https://huggingface.co/microsoft/Phi-4-mini-reasoning) is a compact mathematical verifier. Microsoft's card warns it is math-focused and may be factually weak; do not use it as a general planner.
- The installed Qwen3 14B, DeepSeek-R1-Qwen3 8B, Gemma 4 E2B/E4B, Phi-4 Reasoning Plus, and both Gemma 4 12B quants remain in the benchmark slate.
- The installed `Qwen3.6-27B-Claude-Opus-DeepSeek-Distilled...Q2_K` is a third-party distilled/merged Q2 artifact, not the official [Qwen3.6-27B](https://huggingface.co/Qwen/Qwen3.6-27B) checkpoint. Treat it as an experimental quant, pin its exact hash, and do not transfer official base-model claims to it.
- [Gemma 4 26B-A4B](https://ai.google.dev/gemma/docs/core/model_card_4) official QAT Q4 is roughly 14.4 GB and likely to spill. Test only if compact models leave a clear quality gap.
- [Qwen3.6-35B-A3B](https://huggingface.co/Qwen/Qwen3.6-35B-A3B) and official Qwen3.6-27B are plausible only at aggressive 2–3 bit community quants in the 11–13 GB range. Quantization damage may erase the advantage.

Large sparse models still store all weights even when few parameters are active per token. Qwen3-Coder-Next, Llama 4 Scout, and similarly large MoE models are not practical defaults for this 16 GB nominal setup.

## Runtime choice

Use current [llama.cpp multi-GPU layer splitting](https://github.com/ggml-org/llama.cpp/blob/master/docs/multi-gpu.md) for deliberate dual-GPU tests:

- `layer` is the compatible default and tolerates slow PCIe links.
- `tensor` performs cross-GPU reductions and is a poor first choice for unequal Pascal/Ampere cards without NVLink.
- Start at 8K context, `--split-mode layer`, and quantized KV cache where model/runtime support is verified.
- Start the split from actual free VRAM, then move more work to the faster 3070; do not assume 50/50 is fastest.

[Ollama's FAQ](https://github.com/ollama/ollama/blob/main/docs/faq.mdx) says a model stays on one GPU when it fits and spreads only when needed. Its [GPU documentation](https://github.com/ollama/ollama/blob/main/docs/gpu.mdx) supports both compute capability 8.6 and 6.1 with current Pascal driver requirements. Separate llama.cpp servers pinned to each GPU are more predictable for permanent specialists.

Do not make vLLM the primary runtime here. Its [GPU requirements](https://docs.vllm.ai/en/stable/getting_started/installation/gpu/) exclude the GTX 1080's compute capability and it does not natively support Windows.

For agent protocols, llama.cpp's [server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) covers schema-constrained JSON, tool parsing, reasoning fields, and MCP. Syntax constraints do not prove semantic correctness; benchmark tool selection, arguments, stopping, and side-effect gates separately.

## Template rules matter

- Preserve Qwen3.6 thinking history for agentic tasks when its official template calls for it.
- Gemma 4 generally removes prior thoughts except around tool-call turns.
- gpt-oss requires reasoning state during multi-step tool loops.
- Use each GGUF's official template metadata. Generic ChatML can erase much of the advertised tool performance.

## Provisional role map before final benchmark

| Role | Primary candidate | Independent challenger |
|---|---|---|
| Planner/reasoner/final synthesis | Gemma 4 12B QAT | Qwen3.5-9B |
| Tool/JSON/extraction | Granite 4.1 8B | Qwen3.5-9B |
| Repository coding | Devstral Small 2 | Gemma 4 12B or Qwen3.6 candidate |
| Critic/security review | Different family from producer; Gemma or Qwen | Phi for narrow math only |
| Vision/UI/document | GLM-4.6V-Flash | Gemma 4 12B / Qwen3.5-9B |
| Embedding/reranking | Qwen3 0.6B pair | installed Nomic baseline |

The final routing manifest must be generated from measured local results, not vendor rankings.

## Observed local results and current role decision

All figures below are machine-local measurements from structurally validated, complete artifacts. They remain small synthetic suites rather than proof of project-level or frontier parity.

| Model / placement | Local result | Current use |
|---|---|---|
| Gemma 4 E4B Q4_K_M | 17.714/20 (0.886) on the isolated general screen at 67.94 generated tok/s; 1.0 generic critique but only 0.52 on the executable code suite | Fast planner, final synthesis, and semantic critic after a Granite-produced artifact; do not route repository code to it |
| Granite 4.1 8B Q4_K_M | 17.333/20 (0.867) at 26.61 tok/s; 1.0 tool use, grounding, reasoning, safety, and long-context, but 0 generic critique; executable code 8.0/10 | Always-available GTX 1080 research/grounding and deterministic-evidence specialist; never the sole free-form critic |
| GPT-OSS 20B MXFP4 | Executable code 8.8/10, 48/52 tests, 36.51 tok/s | Primary time-sliced coding escalation on the RTX 3070; retain strict timeout/format handling and no hosted fallback |
| Devstral Small 2 24B Q3_K_M | General screen 9.6/10; executable code 8.55/10 and 47/52 tests; 5.09 tok/s in the code runner | Different-family coding alternate. Use only for hard code work where latency is acceptable |
| Devstral dual-GPU layer split | Two clean generation rounds at 14.57 and 14.56 tok/s versus variable single-3070 rounds at 6.33 and 1.70 tok/s | Preferred Devstral placement; a 5:4 CUDA0:CUDA1 layer split materially reduces spill cost |
| Qwen3.5-9B Q4_K_M vision | 6/6 across two repeats on the matched vision suite; five of six cases generated at 26.50–28.29 tok/s | On-demand vision/UI/document specialist; not kept resident for text work |
| Third-party Qwen3.6 27B Q2_K | Clean rerun was interrupted after 1/10 cases at 4.44 tok/s when the desktop runtime reclaimed LM Studio | Experimental only; excluded from routing and comparison. Do not transfer official Qwen checkpoint claims to this merge/quant |

The clean Gemma-solver/Granite-critic loop did **not** improve aggregate quality: direct 0.593, self-refine 0.192, and cross-specialist 0.587. Cross-specialist repaired one code case and damaged one planning case while using three calls per task. Therefore the route is **direct specialist → deterministic check → cross-family review only after a failed or high-risk check**, never unconditional bounce-back debate.
