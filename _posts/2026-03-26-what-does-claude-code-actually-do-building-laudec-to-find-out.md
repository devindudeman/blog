---
title: "What Does Claude Code Actually Do? Building laudec to Find Out"
description: If you use Claude Code, you've probably had the thought — what is actually happening right now? I built laudec to find out.
---

If you use Claude Code, you've probably had the thought: *what is actually happening right now?*

You type a prompt, Claude does... something, files change, tokens get burned, and you pay for it. But you can't really see what happened between your prompt and the result. How many API calls did that take? What did the system prompt look like? Did it spawn subagents? How fast is the context window filling up? What tools did it decide to use, and which did it reject?

I wanted to know. So I built [laudec](https://github.com/devindudeman/laudec).

## Claude Code is more transparent than you think

Claude Code already exposes a lot about its own operation. The surface area is there, it's just that nobody has wired it all together in one place. There are three channels worth knowing about.

### 1. The API proxy surface

Claude Code reads the `ANTHROPIC_BASE_URL` environment variable. If set, all API traffic routes through that URL instead of going directly to `api.anthropic.com`. This is a first-class configuration point, not a hack. It means you can place anything you want between Claude Code and Anthropic's API: a logging proxy, a cache, a rate limiter, an audit trail.

Every request that flows through this proxy carries the full conversation context: the system prompt, the message history, the tool definitions, the model parameters. Every response carries token usage, cache statistics, rate limit headers, and the complete model output (streamed as SSE events). This is the richest data source available, and capturing it requires nothing more than an HTTP server and an environment variable.

### 2. OpenTelemetry

Claude Code ships with native OpenTelemetry support. Set a few environment variables and it starts emitting structured telemetry over gRPC:

```
CLAUDE_CODE_ENABLE_TELEMETRY=1
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:14317
```

Two categories of data come out. Metrics are counters and gauges exported on a regular interval: `session.count`, `token.usage`, `cost.usage`, `active_time.total`, `lines_of_code.count`, `commit.count`, `pull_request.count`, and `code_edit_tool.decision` (tracking accept/reject rates on edits). Events are point-in-time log records for discrete actions (`user_prompt`, `api_request`, `tool_decision`, `tool_result`). Each event carries a `session.id` attribute that ties everything back to a single Claude Code session, and a `prompt.id` that links all the events triggered by a single user prompt: the API calls it caused, the tools it invoked, the decisions that were made. This is the correlation key that makes it possible to trace a single prompt through the entire chain of actions it triggered.

This is a different view than the proxy gives you. The proxy sees raw HTTP traffic. OTEL sees Claude Code's internal model of what happened: "I decided to use the Read tool," "the tool succeeded in 120ms," "that API call cost $0.0043." You want both.

### 3. Settings and hooks

Claude Code reads project-level configuration from `.claude/settings.local.json`. This file can set environment variables, sandbox rules, and tool permissions. It's the glue that connects the first two channels: you write a settings file that points Claude Code's OTEL exporter at your collector and its API base URL at your proxy, and everything starts flowing.

But Claude Code also has a full lifecycle hook system. Hooks are shell commands, HTTP endpoints, or even LLM prompts that fire at specific points during a session. There are 20+ hook events: `SessionStart`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`, `SubagentStart`, `SubagentStop`, `PreCompact`, `Notification`, and more. Each one receives structured JSON about what's happening and can respond with decisions (allow, deny, block, modify the tool input, inject context into the conversation).

A `PreToolUse` hook can inspect every Bash command before it runs and block destructive operations. A `PostToolUse` hook can auto-format every file after Claude edits it. A `SessionStart` hook can inject git status and open TODOs into the conversation at the top of every session. A `Stop` hook can run your test suite before letting Claude declare it's done, and force it to keep working if tests fail (exit code 2).

These hooks are deterministic. They don't depend on the model remembering your instructions. They fire every time.

For observability purposes, hooks are a third channel alongside the proxy and OTEL. You could log every tool call, capture every permission decision, track subagent lifecycle events, and feed all of it into whatever backend you want. laudec doesn't use hooks yet, just the settings file to wire up the proxy and OTEL collector. But the hook system is sitting right there as a future extension point for even finer-grained visibility.

## What laudec does with all of this

laudec is a single Rust binary that wires up all three channels and gives you a place to look at the results. When you run `laudec .` in a project directory, it:

1. Starts a local HTTP proxy on port 18080
2. Starts a gRPC OTEL collector on port 14317
3. Writes a temporary `.claude/settings.local.json` that routes Claude Code's traffic through both
4. Launches Claude Code as a child process
5. Serves a web dashboard on port 18384
6. Stores everything in a single SQLite database

When the session ends, it restores the original settings file, computes a session summary (duration, cost, tokens, git diff, tool usage), and prints it to the terminal.

No Docker, no external services, no configuration for the default case. The proxy, collector, dashboard, and database are all in the same binary.

### The proxy view

The proxy tab shows Claude Code's actual API conversations. Every call is classified by type:

**MAIN** calls are the primary conversation turns, where Claude Code sends the full context window with extended thinking enabled. These are labeled by turn number so you can track the flow of a session.

**SUBAGENT** calls are spawned by Claude Code's internal delegation system. When it decides a subtask is better handled by a focused agent, it creates a new API call with a specialized system prompt and a constrained tool set. laudec detects these by inspecting the request body and tags them by role: EXPLORE (file search), WEB SEARCH, CC GUIDE, and so on.

**QUOTA** calls are lightweight checks (`max_tokens=1`) that Claude Code uses to verify API access before committing to an expensive request.

**TOKEN COUNT** calls hit the `count_tokens` endpoint to measure context size without generating a response.

For each call, you see the user query and model response rendered as markdown, the tool usage summary (e.g., "Read x3, Edit x2"), token counts, cache statistics, latency, and the raw request/response bodies with syntax highlighting. System-injected blocks like `<system-reminder>` and `<tool-use-rules>` are parsed out and displayed in collapsible sections so you can see exactly what Claude Code appends to your messages behind the scenes.

### The OTEL view

The events tab groups telemetry by conversation turn, anchored by each user prompt. Within a turn, you see the chain of decisions Claude Code made: which API calls it fired, which tools it considered, which it used, whether they succeeded, and how long they took.

Cost visibility comes from this channel. Each `api_request` event carries the exact cost breakdown from Claude Code's own accounting: input tokens, output tokens, cache read tokens, cache creation tokens, and the computed USD cost. The proxy can tell you token counts from the response headers, but only the OTEL data gives you the cost as Claude Code calculated it.

### Insights

The insights tab derives higher-order patterns from the raw data:

**Context growth** shows input tokens per API call over the session. **Cache analysis** shows hit rate and estimated cost savings. **Rate limits** track `x-ratelimit-remaining-requests` and `x-ratelimit-remaining-tokens` from Anthropic's response headers per call. **Stop reasons** aggregate why each API call ended: `end_turn`, `tool_use`, or `max_tokens`.

## What I learned by watching

Building laudec was partly about the tool and partly about what it showed me. I spent a lot of time staring at the dashboard during real sessions, and some of the behavior I found was not what I expected.

### The system prompt is not one thing

Claude Code doesn't have a single monolithic system prompt. What you see in the proxy is a composite assembled from dozens of modular pieces at runtime. Thanks to projects like [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts), which extracts and catalogs these pieces from each Claude Code release, we know the current version (v2.1.x) contains over 110 distinct prompt strings that get composed based on context.

The pieces include: the core system section, tool descriptions for each of the 20+ builtin tools (Bash, Read, Write, Edit, Glob, Grep, WebFetch, TodoWrite, and others), behavioral guidelines for tone and output style, task-doing instructions (avoid over-engineering, read before modifying, no premature abstractions, no unnecessary error handling, minimize file creation), git safety rules, sandbox policy, fork/subagent delegation guidelines, and whatever CLAUDE.md context exists in your project.

The tool descriptions alone are substantial. The Bash tool description is assembled from over 30 fragments covering sandboxing policy, sleep behavior, git commit conventions, parallel command execution, when to prefer builtin tools over shell equivalents, and more. The TodoWrite tool description runs over 2,000 tokens. These aren't decorative. They're the behavioral contract that shapes how Claude Code wields each tool.

When you open a session, all of this gets packed into the first API call and cached. Watching it happen in the proxy, you can see the `system` field span tens of thousands of tokens. Then on the second call, `cache_read_input_tokens` lights up and `cache_creation_input_tokens` drops to zero. The entire system prompt is served from cache at a fraction of the cost for every subsequent call in the session.

### System reminders are injected into your messages

This surprised me. Claude Code doesn't just set a system prompt at the start of the conversation. It actively injects content into subsequent user messages as the session progresses. These show up as XML-tagged blocks appended to what you typed.

`<system-reminder>` blocks carry context-sensitive instructions: file-was-modified-externally notifications, TodoWrite reminders, token usage stats, plan mode activation (which alone is over 1,000 tokens of multi-phase planning instructions). `<tool-use-rules>` blocks remind the model about tool constraints. `<available-deferred-tools>` lists tools that can be loaded on demand.

The catalog of known system reminders is extensive. There are ~40 distinct reminder types covering everything from "file exists but is empty" warnings, to hook success/failure notifications, to LSP diagnostic alerts, to team coordination instructions for multi-agent swarm mode. These are injected conditionally based on session state. You might never see most of them, but the ones that fire directly shape what the model does next.

In laudec's proxy tab, these blocks are parsed out and displayed in collapsible sections beneath your actual message. You can see exactly what Claude Code appends on your behalf, and how much context budget it eats.

### Subagents are a parallel conversation you can't see

A single user prompt can spawn half a dozen API calls. When Claude Code decides to explore a codebase, it doesn't do it in the main conversation thread. It launches an Explore subagent with its own system prompt, a read-only tool set (Read, Glob, Grep, LS), and its own conversation history. The subagent does its work, returns a summary, and the main agent incorporates the result.

The subagent architecture goes deeper than just Explore. Claude Code has specialized agents for planning (Plan mode, with its own enhanced prompt), web fetching (a summarizer agent that distills verbose page content), bash command risk assessment (a policy spec evaluator that classifies command prefix risk levels), conversation compaction (for summarizing history when context gets long), session title generation, CLAUDE.md creation, security review, verification, and even "dream memory consolidation" for cross-session knowledge synthesis.

In the proxy, this looks like a MAIN call, then two or three SUBAGENT calls firing in quick succession with noticeably smaller context windows (no extended thinking, focused system prompts, limited tool sets), then the main conversation resuming. The subagent calls are often cheaper per-call, but they add up. A complex refactoring prompt might generate 15+ API calls total, and you'd never know from the terminal output.

laudec tags each subagent by role by inspecting the system prompt content. "file search specialist" becomes EXPLORE. "web search tool use" becomes WEB SEARCH. "Claude Code Guide" becomes CC GUIDE. These heuristics are fragile (they depend on prompt wording that Anthropic changes between releases), but they make the multi-agent orchestration visible.

### Tool decisions happen before tool results

The OTEL telemetry separates `tool_decision` events from `tool_result` events. This means you can see what Claude Code *considered* doing, not just what it did. A `tool_decision` fires when Claude Code evaluates whether to allow a tool the model requested, capturing the accept/reject outcome and the decision source (config rule, hook, user approval). A `tool_result` fires when the tool actually executes. The gap between them is where permission checks, sandbox validation, and user approval happen.

In the events tab, you can trace the full chain: user_prompt → api_request → tool_decision (Read) → tool_result (success, 45ms) → tool_decision (Edit) → tool_result (success, 12ms) → api_request → ... You can see exactly where time goes. In sessions with many tool calls, the cumulative tool execution time can rival or exceed the API latency.

The `tool_result` events also carry a `success` boolean, and when `OTEL_LOG_TOOL_DETAILS=1` is set, they include the `tool_input` with file paths, search patterns, and command arguments (truncated to ~4K characters). This means you can see not just *that* a tool was used, but *what it was asked to do* and *whether it worked*. Failed tool calls show up in laudec's metrics tab as red failure counts next to each tool name.

### Context growth is predictable, mostly

In a typical session, input tokens grow roughly linearly. Each turn adds your prompt, the model's response, and any tool results to the conversation history. The context growth chart in laudec's insights tab makes this staircase pattern visible.

But there are disruptions. A large file read (the Read tool pulling in a 2,000-line source file) causes a sudden spike. Claude Code's internal conversation compaction, which fires when context approaches the model's limit, causes a sharp drop. And subagent calls don't grow the main context at all since they have their own isolated conversation.

Worth paying attention to: the relationship between cache reads and context size. As the session progresses and the context window fills, the ratio of cached tokens to fresh input tokens increases. The system prompt and early conversation history stay cached while only the newest messages are "fresh." Longer sessions are actually more cost-efficient per-turn than short ones, up to the point where compaction fires and reshuffles the cache.

### The quota check

Before the first real API call in a session, Claude Code sends a request with `max_tokens: 1`. This is a quota check: a near-zero-cost probe to verify that the API key is valid and rate limits haven't been hit before committing tokens to a real call.

You can see these in the proxy tab as QUOTA-type calls. They return almost instantly (usually under 200ms) and consume negligible tokens. If you're troubleshooting authentication or rate limit issues, these are the first calls to inspect.

### Rate limit headroom

Anthropic's API responses include headers like `x-ratelimit-remaining-requests` and `x-ratelimit-remaining-tokens`. Claude Code doesn't surface this information anywhere in its UI. But the proxy captures every response header, and laudec's insights tab tracks these values over time.

In normal usage, rate limits are a non-issue. But in heavy sessions, especially those with many subagent calls, you can watch the remaining-requests counter drop. If you're running multiple Claude Code instances or using agentic orchestration tools that spawn parallel sessions, this visibility matters. laudec's threshold warnings (red highlights when remaining requests drop below 10 or remaining tokens below 10,000) make it possible to anticipate rate limit problems rather than discovering them mid-session.

### Stop reasons tell you how the model is being used

Every API call ends with a `stop_reason`: `end_turn` (the model finished its response), `tool_use` (the model wants to call a tool and is yielding control), or `max_tokens` (the response hit the token limit).

In a healthy session, you'll see a mix of `tool_use` and `end_turn` stops. `tool_use` stops dominate during active work (the model is in a loop of reading, editing, running commands), and `end_turn` appears when the model reports back to you.

A session full of `max_tokens` stops tells a different story. It means the model is repeatedly hitting the output ceiling, which usually indicates the context window is nearing its limit and responses are getting truncated. Watching the stop reason distribution in laudec's insights tab alongside the context growth chart gives you early warning that a session is running hot.

### Cost scales with decisions, not prompts

What you pay has almost nothing to do with how many prompts you type. It depends on what Claude Code decides to do with each one. A 10-prompt session where each prompt triggers a single tool call costs far less than a 3-prompt session where each prompt triggers a multi-step tool chain with subagent exploration, file reads, edits, and verification.

The OTEL `api_request` events make this visible. Each event carries a `cost_usd` attribute calculated by Claude Code itself. Sorting sessions by cost and comparing them to prompt count reveals that the biggest cost driver is usually one or two prompts that trigger deep exploration or complex multi-file edits. The "fix the tests" prompt that spawns 8 subagent calls and reads 15 files costs more than the rest of the session combined.

Once you see this, it affects how you write prompts. Specific, well-scoped requests ("fix the type error in `parser.rs` line 42") generate simple tool chains. Broad requests ("refactor the authentication system") trigger deep subagent exploration. Both are fine. But without visibility into the actual call graph, you can't know what each one costs or why.

## Try it

laudec is [on GitHub](https://github.com/devindudeman/laudec). It's MIT licensed, written in Rust with a Svelte dashboard, and I'd welcome feedback on what's useful and what's missing.

The point of laudec is to learn. I wanted to see what was actually happening when I handed my project to an AI coding agent and said "fix the tests." Now I can. If you're curious about the same thing, give it a try.
