# Auxiliary model

## User experience

The existing model menu offers an optional auxiliary model; a compact + AI badge indicates that delegation is enabled. The primary agent decides when to use it, selects source ranges, and selects the deadline. No user-supplied file scope or time budget is required. A task status card inside the assistant content reports waiting, validation, completion and errors, alongside the existing tool details. The normal Stop action stops the parent task and its extension process tree.

Preferences are cached per session in localStorage and persisted server-side when a turn starts, including remapping temporary session IDs to persisted IDs. A new browser loads the server preference when no local preference exists. Local selection wins when present; changes persist to the server on the next submitted turn, not immediately across devices. Restart recovery includes the selected auxiliary model.

## Execution and resource bounds

The named stdio extension reads selected source excerpts directly and calls the configured OpenAI-compatible router. Raw source is not returned to the primary model. The result contains concise analysis, source references, elapsed time, reported provider usage, applied changes and checks. No polling or background timer per UI task is used; progress is event-driven. Preference requests are coalesced and the in-memory map is bounded. Settings disk writes happen on changes, not polling.

Analysis and focused-edit modes use one provider call per invocation, with no automatic retries or fallback spending. Analysis defaults to 120 seconds; edit defaults to 180 seconds. The primary agent may choose 30-240 seconds. Each extension process permits at most 3 calls, including failures, and only one active call. The request and response body share the HTTP abort deadline. MCP cancellation and input close abort active requests. Provider-side computation may continue after disconnection; local abort cannot guarantee remote cancellation.

Input is limited to 8 source ranges, 600 lines each, 60000 excerpt characters total, and 2 MiB per file. Canonical paths must stay within the workspace. Common secret paths, .git and node_modules are excluded; binary files are rejected. This is not comprehensive secret detection: credentials embedded in ordinary source may still be sent to the provider. The primary agent must avoid selecting secrets.

## Focused edits and verification

The auxiliary has no shell, arbitrary tool access, nested agents or deployment permissions. Edit mode returns structured exact-text replacements in existing supplied files/ranges. No new files or file deletion. The executor validates the entire proposal before writing, checks source hashes against concurrent changes, rejects ambiguous replacements and hard-linked files, preserves CRLF, and runs node --check for JS/CJS/MJS candidates before applying them. Non-JS checks are explicitly marked not_checked.

The primary agent must inspect the resulting diff and run relevant functional tests. Syntax success is not functional verification. A failure during a multi-file write reports already-applied paths; changes are never blindly rolled back over user edits. The implementation uses optimistic concurrency, not OS-level locks against arbitrary external editors.

## Validation

30 regression tests passed, including real stdio MCP initialization, bounded source reads, source exclusion, fake-provider analysis/edit calls, abort timeout, syntax rejection without writes, concurrent-change rejection, CRLF preservation, settings persistence and UI session isolation. Existing UI script syntax and session/restart tests pass. No browser screenshot/mobile interaction automation was available in this run.

Live Gemini router smoke test: ag/gemini-3.8-flash returned AUX_OK in 66244 ms on a trivial request with no source files. Reported usage was 2551 tokens. This confirms upstream latency is significant even for a tiny request; delegation does not remove that latency. Full goose-to-extension-to-live-model execution still requires a real user turn after activation; the provider and MCP paths were verified separately.

## Official references verified

- https://goose-docs.ai/docs/guides/goose-cli-commands (--with-extension named stdio command)
- https://goose-docs.ai/docs/getting-started/using-extensions (stdio extension lifecycle/configuration)
- https://goose-docs.ai/docs/guides/context-engineering/subagents (context isolation and built-in delegation alternatives)

## Streaming optimization

Auxiliary requests now stream content with bounded SSE parsing, throttled progress (at most once per second), first-content latency and optional usage reporting. Interrupted or length-truncated output is rejected before applying edits. JSON responses remain supported for compatible providers. Edit proposals use original start/end line numbers rather than repeating original source; exact-text legacy edits remain accepted. Multiple excerpts of the same file are supported; overlapping line edits are rejected. Output budgets: 1200 tokens for analysis, 4000 for edits.

Router model inventory confirmed adaptive/high/medium/low Gemini 3.8 IDs and thinkingEffortSupported=false. No undocumented reasoning parameters were added and no router settings were changed. A concurrent two-request smoke test of adaptive and low both hit 120s without content, so low was not selected as a supposedly faster default. Router queue/retry internals are not available from the model inventory endpoint. Streaming improves observability, not a guaranteed speedup.

## Activation and preference fix

Model selections now save immediately via a bounded POST /api/auxiliary-settings request. Client saves are serialized per session, JSON content type is checked, and failed saves show a warning while keeping local selection for the next turn. An omitted auxiliaryModel in a chat request uses the persisted session preference; an explicit empty string disables it. Live Claude Sonnet 5.5 High analysis previously completed in 7237ms (first content 6387ms). Server restart is required to expose the new settings route; serving the new HTML alone is insufficient.
