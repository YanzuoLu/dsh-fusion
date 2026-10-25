# dsh-fusion

An optional lead/worker collaboration mode for DeepSeek Harness Web, inspired by Devin Fusion. This is an instruction plugin, not Cognition's Fusion model router or a new agent runtime.

## Usage

The composer button reads **Devin Fusion On** or **Devin Fusion Off**, in English regardless of the DSH locale. It sits between the side-chat action and subagent-model selector when those plugins are present. The name uses the native model-selector body color, and On/Off uses the lighter caption color. On compact layouts the native icon and On/Off remain visible. Click to switch, with no dropdown.

Every ordinary session starts Off unless it has a saved preference. Turning it on contributes the approved [lead instructions](prompts/lead.md) to that session and the approved [worker instructions](prompts/worker.md) to its actual DSH subagents. Read-only or unavailable controls cannot change the preference.

## Three effective states

- **Lead** when an ordinary session's own switch is on.
- **Worker** when a subagent's ordinary root main session has its switch on.
- **Off** otherwise.

Subagents, including nested children, follow their root main session dynamically. Switching main Off removes the worker contribution on each child's next model-request assembly, including after resume. Switching On also affects already-created children. Already assembled or in-flight requests are not canceled or rewritten. No special first-turn or resume injection is needed.

Only ordinary-session preferences are stored. Side chats and ordinary forks are ordinary sessions with independent switches, Off by default. A `parentSession` relationship alone does not make a session a worker. The subagent view does not expose a writable switch; change the setting in its main session.

## Native context mechanism

This plugin registers one `systemPrompt.context` contribution, `devin-fusion:role`, immediately after native `subagent:delegation` in runtime-context order. Its provider returns the lead text, worker text, or an empty string. DSH's existing runtime-context projector compares the complete rendered snapshot with its previous retained snapshot and appends a new snapshot only when needed.

These are native **user-role runtime-context instructions**, not a replacement system prompt. An unchanged snapshot is not repeatedly appended on continuation or resume. Other runtime-context changes or compaction can cause DSH to publish a fresh complete snapshot, including the applicable Fusion instructions. A newer snapshot explicitly supersedes earlier runtime-context snapshots.

The plugin does not register or rewrite tools, tool descriptions, schemas, ordering, visibility, permissions, model routes, or front system sections. It does not modify delegation arguments, the original task prompt, or inbox messages, and does not install custom message-insertion hooks. Main and worker roles can differ without this plugin rewriting the inherited system prefix. Actual cache hits still depend on the provider, model, cache keys, expiry, and other prompt or tool changes.

The instructions guide model behavior; they do not enforce a new orchestration mechanism or guarantee a particular result. External agent processes which do not use this DSH prompt assembly are not modified. Runtime context must remain enabled in the DSH deployment.

## Install and update

```sh
dsh plugin --profile web add github:YanzuoLu/dsh-fusion
dsh plugin --profile web update dsh-fusion
```

No DSH restart is needed for installation or implementation releases. Browser client updates may need a page refresh. A stable bootstrap owns the context registration, API routes, and settings, and loads immutable versioned host modules. Implementation updates preserve live agents and settings and wait for admitted settings operations to finish. Import or interface failures leave the previous implementation active. Changes to the bootstrap or dependency graph require separate review.

## Development

```sh
npm run build
```

Approved instruction sources live in `prompts/`. Build publishes them together with [host.js](<lib/host.js>) into an immutable `dist/host/<revision>/` directory, and updates [release.json](<release.json>). Publish the generated artifacts and manifest together. Tests and intermediate fixtures belong in the gitignored `.cache/` directory and are not included in the package.

Tested with DSH **0.2.0-rc.2**. The integration uses native context, agent lifecycle, metadata-query, storage-domain, HTTP route, and composer-slot APIs. No DSH core file is patched.
