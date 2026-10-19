# Customer Display Operating Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one secure, offline customer-display experience that runs either on a certified cable-connected second monitor, on one locally paired tenant tablet, or on both at once.

**Architecture:** The Electron main process owns the display state machine, countdown, single DSLR live-view producer, latest-frame broker, wired kiosk lifecycle, and local BYOD server. A customer-only React surface consumes the same validated snapshots and bounded JPEG envelopes through either a read-only Electron preload or an authenticated local WebSocket; the existing operator renderer configures and diagnoses both modes through validated IPC.

**Tech Stack:** Electron 34, React 19, TypeScript 5.7, Vite 6, Zustand 5, Zod 3, Node 22 HTTP/crypto/network APIs, `ws`, Vitest 3, Testing Library, existing SQLite `station_config`, existing Sharp/QR utilities.

**Spec:** `docs/superpowers/specs/2026-10-19-customer-display-operating-modes-design.md`

## Global Constraints

- Certified Wired Display is the qualification baseline; BYOD is a supported compatibility mode, not an equal latency guarantee.
- The four persisted modes are exactly `off`, `wired`, `tablet`, and `both`; the feature defaults to `off`.
- Live view is mirrored only in presentation; captured and previewed photographs remain unmirrored.
- Countdown is main-process authoritative and exactly 3 seconds; successful still preview lasts exactly 2 seconds.
- Only one capture sequence and one paired tablet may exist at a time.
- An unused pairing token expires after 10 minutes; reconnect grace is 5 minutes; paired-cookie hard lifetime is 12 hours.
- BYOD default port is TCP `47940`; only a selected private IPv4 interface is accepted.
- Installer-managed firewall access covers only TCP `47940`; a non-default port is advanced/unqualified and requires the explicit manual Private-profile rule shown by diagnostics.
- Each sink retains only the latest snapshot, one preview, and one live frame; a sink that cannot accept state or preview within 2 seconds is disconnected.
- Start live view on the first ready display consumer and stop it 5 seconds after the last consumer leaves.
- Customer display transport, images, pairing, and diagnostics remain local; no Supabase, web-portal, or cloud API changes are permitted.
- Keep `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, navigation denial, and new-window denial for both Electron surfaces.
- Never log or persist pairing tokens, cookies, image bytes, gallery tokens, or captured local file paths.
- Display absence or failure must not block existing capture, approval, print, upload, or gallery workflows.
- Do not claim physical certification until the documented Windows/display/tablet/DSLR qualification matrix has recorded evidence.
- Overlay animations must be flashy and modern (punchy 3-2-1 countdown scale/pop transitions, dynamic pulse/glow effects, sleek backdrop-blur badges, crisp framing guides, and an energetic shutter flash, while maintaining graceful fallbacks for prefers-reduced-motion).

## File Structure

### Shared contracts

- `packages/contracts/src/display.ts` — display modes, phases, snapshots, settings, targets, statuses, IPC request schemas, and binary-frame metadata.
- `packages/contracts/src/index.ts` — exports the display contract.
- `packages/contracts/test/customer-display-contracts.test.ts` — runtime validation and defaults.

### Electron main process

- `apps/operator-desktop/src/main/display/display-settings.ts` — validated persistence over `StationDatabase.station_config`.
- `apps/operator-desktop/src/main/display/frame-broker.ts` — monotonic frame envelopes, per-sink backpressure, coalescing, and metrics.
- `apps/operator-desktop/src/main/display/customer-display-coordinator.ts` — authoritative phase machine, countdown/capture serialization, preview lifetime, and live-view consumer lifecycle.
- `apps/operator-desktop/src/main/display/wired-display-manager.ts` — display discovery/fingerprinting, ambiguity handling, hot-plug, identify windows, and kiosk lifecycle.
- `apps/operator-desktop/src/main/display/tablet-display-server.ts` — private-LAN HTTP/WebSocket service, token/cookie pairing, reconnect, heartbeat, and static customer renderer.
- `apps/operator-desktop/src/main/display/customer-display-runtime.ts` — composes coordinator, frame broker, wired manager, and tablet server behind one API used by IPC/bootstrap.
- `apps/operator-desktop/src/main/index.ts` — initializes the runtime, registers validated IPC, and shuts it down.
- `apps/operator-desktop/src/main/orchestrator.ts` — exposes the required-shot count for a validated cached template without leaking package internals.
- `apps/operator-desktop/src/main/db.ts` — unchanged schema; existing station-config helpers are consumed.
- `apps/operator-desktop/src/preload/display.ts` — read-only customer bridge.
- `apps/operator-desktop/src/preload/index.ts` — operator display-management bridge.

### Renderers

- `apps/operator-desktop/src/renderer/customer-display/CustomerDisplayApp.tsx` — customer-only semantic presentation.
- `apps/operator-desktop/src/renderer/customer-display/customer-display.css` — responsive, safe-area, mirror, flashy and modern overlay animations (countdown pop/glow, shutter flash, status transitions), and reduced-motion styling.
- `apps/operator-desktop/src/renderer/customer-display/transport.ts` — Electron or BYOD transport selection, stale-data rejection, blob lifecycle, and reconnect state.
- `apps/operator-desktop/src/renderer/customer-display/view-model.ts` — pure mapping from validated snapshot to visible copy/progress/image rules.
- `apps/operator-desktop/src/renderer/display-settings/DisplaySettingsPanel.tsx` — operator mode, target, pairing, and diagnostics controls.
- `apps/operator-desktop/src/renderer/display-settings/display-settings.css` — operator panel styling within the existing dark studio palette.
- `apps/operator-desktop/src/renderer/main.tsx` — selects operator or customer surface from the trusted launch URL.
- `apps/operator-desktop/src/renderer/store.ts` — display configuration/status actions and session-reset notification.
- `apps/operator-desktop/src/renderer/App.tsx` — mounts the display settings panel and status warning.

### Tests and operations

- `apps/operator-desktop/test/customer-display-coordinator.test.ts` — phase, timer, race, failure, cleanup, and live-view lifecycle tests.
- `apps/operator-desktop/test/customer-display-frame-broker.test.ts` — backpressure and bounded-memory tests.
- `apps/operator-desktop/test/wired-display-manager.test.ts` — discovery, persistence matching, ambiguity, and hot-plug tests.
- `apps/operator-desktop/test/tablet-display-server.test.ts` — HTTP/WebSocket pairing and security tests.
- `apps/operator-desktop/test/customer-display-renderer.test.tsx` — rendering, accessibility, mirroring, stale data, and blob cleanup tests.
- `apps/operator-desktop/test/customer-display-runtime.test.ts` — integration with mock camera/session capture while displays disconnect.
- `apps/operator-desktop/package.json` and `pnpm-lock.yaml` — direct runtime/test dependencies.
- `apps/operator-desktop/electron-builder.json` and `apps/operator-desktop/build/installer.nsh` — Private-profile BYOD firewall rule lifecycle.
- `docs/hardware-and-operations-runbook.md` — setup, pairing, fallback, firewall, and qualification procedures.
- `docs/customer-display-qualification-template.md` — evidence sheet for every certified hardware/browser combination.

## Review Focus

- A preferred monitor returns with a changed Electron ID or collides with an identical monitor: Task 4 tests deterministic matching and mandatory operator reselection on ambiguity.
- A tablet sleeps, reconnects inside/outside the 5-minute grace, or presents an expired 12-hour cookie: Task 5 tests reclaim versus forced re-pairing.
- A wired/tablet sink is slower than the camera and cannot accept priority data within 2 seconds: Task 2 and Task 5 test frame dropping, bounded memory, and disconnect/resync.
- A display disappears or the session changes during countdown/capture: Task 2 and Task 7 test that countdown cancellation is generation-safe and a started shutter cannot be misattributed.
- Preview bytes or blob URLs survive after preview/session completion: Task 2 and Task 3 test immediate memory and browser-resource cleanup.

---

### Task 1: Display Contracts and Persisted Settings

**Files:**
- Create: `packages/contracts/src/display.ts`
- Modify: `packages/contracts/src/index.ts:1-7`
- Create: `packages/contracts/test/customer-display-contracts.test.ts`
- Create: `apps/operator-desktop/src/main/display/display-settings.ts`
- Create: `apps/operator-desktop/test/customer-display-settings.test.ts`
- Consume unchanged: `apps/operator-desktop/src/main/db.ts:934-961`

**Interfaces:**
- Consumes: `StationDatabase.getStationConfig(key: string): string | null` and `setStationConfig(key: string, value: string): void`.
- Produces: `DisplayMode`, `CustomerDisplayPhase`, `CustomerDisplaySnapshot`, `CustomerDisplayFrameMeta`, `DisplayTarget`, `DisplaySettings`, `WiredDisplayStatus`, `TabletDisplayStatus`, `DisplayOverview`, their Zod schemas, and validated display IPC request schemas.
- Produces: `loadDisplaySettings(db: StationDatabase): DisplaySettings` and `saveDisplaySettings(db: StationDatabase, settings: DisplaySettings): DisplaySettings`.

- [ ] **Step 1: Write failing contract tests**

Add tests named `defaults display mode to off and port to 47940`, `accepts every customer phase`, `rejects public bind addresses and malformed snapshots`, and `never exposes pairing secrets in paired status`. Assert the exact modes, phases, countdown bounds `1..3`, port bounds `1024..65535`, default `mirroredLiveView: true`, and that `pairingUrl`/`pairingQrDataUrl` are nullable and must both be null once status is `paired`.

- [ ] **Step 2: Run the contract test and verify failure**

Run: `pnpm exec vitest run packages/contracts/test/customer-display-contracts.test.ts`

Expected: FAIL because `packages/contracts/src/display.ts` and its exports do not exist.

- [ ] **Step 3: Implement the display contract**

Define and export the Zod schemas/types listed above. `CustomerDisplaySnapshot` must include `revision`, `phase`, `sessionGeneration`, nullable `sessionId`, `shotIndex`, `shotCount`, nullable `countdownValue`, `message`, `mirroredLiveView`, nullable `liveFrameSequence`, nullable `previewFrameSequence`, and ISO `updatedAt`. Do not put token/cookie fields in a paired status object.

- [ ] **Step 4: Write failing settings persistence tests**

Test missing/malformed persisted JSON falling back to `DisplaySettingsSchema.parse({})`, valid settings round-tripping under key `customer_display_settings_v1`, and transient status/pairing fields never being persisted.

- [ ] **Step 5: Run the settings test and verify failure**

Run: `pnpm exec vitest run apps/operator-desktop/test/customer-display-settings.test.ts`

Expected: FAIL because `loadDisplaySettings` and `saveDisplaySettings` do not exist.

- [ ] **Step 6: Implement validated settings persistence**

Create only the two exported functions in `display-settings.ts`; catch invalid JSON, return schema defaults, and persist only `DisplaySettings`.

- [ ] **Step 7: Run focused tests and typecheck**

Run: `pnpm exec vitest run packages/contracts/test/customer-display-contracts.test.ts apps/operator-desktop/test/customer-display-settings.test.ts && pnpm --filter @odc-photostudio/contracts typecheck && pnpm --filter @odc-photostudio/operator-desktop typecheck`

Expected: all tests PASS and both typechecks exit 0.

- [ ] **Step 8: Commit**

```powershell
git add packages/contracts/src/display.ts packages/contracts/src/index.ts packages/contracts/test/customer-display-contracts.test.ts apps/operator-desktop/src/main/display/display-settings.ts apps/operator-desktop/test/customer-display-settings.test.ts
git commit -m "feat(display): define customer display contracts"
```

### Task 2: Authoritative Display Coordinator and Bounded Frame Broker

**Files:**
- Create: `apps/operator-desktop/src/main/display/frame-broker.ts`
- Create: `apps/operator-desktop/src/main/display/customer-display-coordinator.ts`
- Create: `apps/operator-desktop/test/customer-display-frame-broker.test.ts`
- Create: `apps/operator-desktop/test/customer-display-coordinator.test.ts`
- Reference: `apps/operator-desktop/src/main/camera/provider.ts:7-30`

**Interfaces:**
- Consumes: Task 1 `CustomerDisplaySnapshot`, `CustomerDisplayFrameMeta`, and phases.
- Produces: `DisplaySink = { id: string; offerSnapshot(snapshot): boolean; offerFrame(frame): boolean; disconnect(reason: string): void }` and `DisplayStreamMetrics`.
- Produces: `encodeDisplayFrame(frame: CustomerDisplayFrame): Uint8Array` and `decodeDisplayFrame(bytes: Uint8Array): CustomerDisplayFrame` using a 20-byte big-endian header: ASCII `ODCF` (bytes 0–3), protocol version `1` (byte 4), kind `1=live|2=preview` (byte 5), reserved zero bytes 6–7, unsigned 32-bit sequence (bytes 8–11), float64 capture epoch milliseconds (bytes 12–19), then JPEG bytes.
- Produces: `LatestFrameBroker.addSink(sink: DisplaySink): () => void`, `publishSnapshot(snapshot: CustomerDisplaySnapshot): void`, `publishLive(jpeg: Uint8Array, capturedAtMs: number): number`, `publishPreview(jpeg: Uint8Array, capturedAtMs: number): number`, `clearPreview(): void`, `ackSnapshot(sinkId: string, revision: number): void`, `ackFrame(sinkId: string, sequence: number): void`, and `getMetrics(): DisplayStreamMetrics`.
- Produces: `CustomerDisplayCoordinator.beginSession(input: { sessionId: string; shotCount: number }): void`, `runCapture<T>(input: { sessionId: string; frameIndex: number; capture: () => Promise<{ result: T; previewJpeg: Uint8Array; allCaptured: boolean }> }): Promise<T>`, `approveSession(sessionId: string): void`, `resetSession(): void`, `setCameraReady(ready: boolean): void`, `addConsumer(id: string): Promise<void>`, `removeConsumer(id: string): void`, `getSnapshot(): CustomerDisplaySnapshot`, `subscribe(listener): () => void`, and `close(): Promise<void>`.

- [ ] **Step 1: Write failing frame-broker tests**

Cover exact binary header round-trip/rejection, monotonic sequence numbers, at most one unacknowledged live frame per sink, replacement of stale live frames, preview priority, latest-snapshot coalescing, old acknowledgements being ignored, metrics, and forced sink disconnect when priority data remains blocked for 2 seconds.

- [ ] **Step 2: Run the broker test and verify failure**

Run: `pnpm exec vitest run apps/operator-desktop/test/customer-display-frame-broker.test.ts`

Expected: FAIL because `LatestFrameBroker` is missing.

- [ ] **Step 3: Implement the broker**

Use injected clock/timer functions for deterministic tests. Copy or transfer only the currently retained frame and clear preview bytes when asked; never maintain an array of historical frames.

- [ ] **Step 4: Write failing coordinator tests**

Use fake timers and a fake camera-lifecycle adapter. Assert `idle → live → countdown(3,2,1) → capturing → preview → live/review`, exact 2-second preview, `review → complete`, reset cleanup, `DISPLAY_CAPTURE_BUSY`, countdown cancellation by session generation, rejection of session replacement after shutter begins, recovery after capture failure, and live view start-on-first/stop-5-seconds-after-last consumer.

- [ ] **Step 5: Run the coordinator test and verify failure**

Run: `pnpm exec vitest run apps/operator-desktop/test/customer-display-coordinator.test.ts`

Expected: FAIL because `CustomerDisplayCoordinator` is missing.

- [ ] **Step 6: Implement the coordinator**

Use one monotonically increasing snapshot revision and one `AbortController`/generation guard for the active sequence. Return the capture result immediately after preview publication; schedule the preview-to-live/review transition without keeping the caller blocked for 2 seconds.

- [ ] **Step 7: Run focused tests and typecheck**

Run: `pnpm exec vitest run apps/operator-desktop/test/customer-display-frame-broker.test.ts apps/operator-desktop/test/customer-display-coordinator.test.ts && pnpm --filter @odc-photostudio/operator-desktop typecheck`

Expected: all tests PASS and typecheck exits 0.

- [ ] **Step 8: Commit**

```powershell
git add apps/operator-desktop/src/main/display/frame-broker.ts apps/operator-desktop/src/main/display/customer-display-coordinator.ts apps/operator-desktop/test/customer-display-frame-broker.test.ts apps/operator-desktop/test/customer-display-coordinator.test.ts
git commit -m "feat(display): coordinate countdown and bounded frames"
```

### Task 3: Customer-Only Renderer and Read-Only Electron Bridge

**Files:**
- Create: `apps/operator-desktop/src/preload/display.ts`
- Create: `apps/operator-desktop/src/renderer/customer-display/CustomerDisplayApp.tsx`
- Create: `apps/operator-desktop/src/renderer/customer-display/customer-display.css`
- Create: `apps/operator-desktop/src/renderer/customer-display/transport.ts`
- Create: `apps/operator-desktop/src/renderer/customer-display/view-model.ts`
- Modify: `apps/operator-desktop/src/renderer/main.tsx:1-11`
- Modify: `apps/operator-desktop/src/renderer/index.html:1-13`
- Modify: `apps/operator-desktop/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/operator-desktop/test/customer-display-renderer.test.tsx`

**Interfaces:**
- Consumes: Task 1 snapshot/frame contracts and Task 2 sequence/ack semantics.
- Produces: `window.odcDisplayBridge.getSnapshot(): Promise<CustomerDisplaySnapshot>`, `onSnapshot(listener): () => void`, `onFrame(listener): () => void`, `ackSnapshot(revision: number): void`, and `ackFrame(sequence: number): void`; it exposes no generic invoke method and no operator bridge.
- Produces: `createCustomerDisplayTransport(location: Location): CustomerDisplayTransport` and `toCustomerDisplayViewModel(snapshot): CustomerDisplayViewModel`.

- [ ] **Step 1: Add renderer test dependencies and write failing view tests**

Add `@testing-library/react`, `@testing-library/jest-dom`, and `jsdom` as desktop dev dependencies. Test every phase’s exact visible message, shot progress, `aria-live` countdown, non-interactive surface, mirror class only on live view, unmirrored preview, portrait/landscape-safe container classes, flashy and modern overlay animation classes/timing, and reduced-motion flash behavior.

- [ ] **Step 2: Run the renderer test and verify failure**

Run: `pnpm exec vitest run apps/operator-desktop/test/customer-display-renderer.test.tsx --environment jsdom`

Expected: FAIL because the customer renderer modules do not exist.

- [ ] **Step 3: Implement the view model, component, and styles**

Use a single `<main>` with status semantics, safe-area CSS, `object-fit: contain`, neutral letterboxing, and no buttons/links/forms. Implement flashy and modern overlay animations (high-impact 3-2-1 scale-in/pop countdown numbers with pulse/glow dynamics, sleek frosted glass/backdrop-blur badge overlays, crisp framing guides, and an energetic shutter flash transition, falling back gracefully under `prefers-reduced-motion`). Use actual product copy from the spec; do not introduce tenant branding or decorative stock UI.

- [ ] **Step 4: Implement transport selection and resource cleanup**

Select the Electron bridge when present and the BYOD WebSocket otherwise. Validate every snapshot, discard non-increasing revisions/sequences, create one blob URL per accepted JPEG, revoke the replaced URL immediately, and revoke all URLs on preview exit/unmount.

- [ ] **Step 5: Implement the read-only customer preload and renderer entry selection**

Load `CustomerDisplayApp` only when the trusted launch parameter is `surface=customer`; otherwise preserve `OperatorCaptureApp`. The customer preload must remove IPC listeners through every returned unsubscribe callback.

- [ ] **Step 6: Expand tests for stale data and cleanup**

Assert stale revision/frame rejection, frame acknowledgement after render acceptance, preview URL revocation after 2 seconds/state change, cleanup on unmount, and absence of `odcOperatorBridge` from the customer surface.

- [ ] **Step 7: Run renderer tests and build**

Run: `pnpm exec vitest run apps/operator-desktop/test/customer-display-renderer.test.tsx --environment jsdom && pnpm --filter @odc-photostudio/operator-desktop build`

Expected: tests PASS; TypeScript and Vite builds exit 0 with both renderer paths in the bundled output.

- [ ] **Step 8: Commit**

```powershell
git add apps/operator-desktop/src/preload/display.ts apps/operator-desktop/src/renderer/customer-display apps/operator-desktop/src/renderer/main.tsx apps/operator-desktop/src/renderer/index.html apps/operator-desktop/package.json pnpm-lock.yaml apps/operator-desktop/test/customer-display-renderer.test.tsx
git commit -m "feat(display): add customer-facing display surface"
```

### Task 4: Certified Wired Display Manager

**Files:**
- Create: `apps/operator-desktop/src/main/display/wired-display-manager.ts`
- Create: `apps/operator-desktop/test/wired-display-manager.test.ts`
- Modify: `apps/operator-desktop/src/main/index.ts:206-251`

**Interfaces:**
- Consumes: Task 1 `DisplayTarget`/settings/status and Task 3 `display.ts` preload/customer launch parameter.
- Produces: `WiredDisplayManager.listTargets(): DisplayTarget[]`, `identify(fingerprint: string): Promise<void>`, `open(fingerprint: string): Promise<WiredDisplayStatus>`, `close(): void`, `getStatus(): WiredDisplayStatus`, `onStatus(listener): () => void`, and `dispose(): void`.
- Produces: injected `ElectronScreenAdapter` and `CustomerWindowFactory` boundaries so unit tests never require a physical display.

- [ ] **Step 1: Write failing display discovery and matching tests**

Test primary/external classification, composite fingerprint creation, changed numeric ID matching, prior-geometry fallback, identical-display ambiguity, removed preferred display, and deterministic ordering for operator selection.

- [ ] **Step 2: Run the wired manager test and verify failure**

Run: `pnpm exec vitest run apps/operator-desktop/test/wired-display-manager.test.ts`

Expected: FAIL because `WiredDisplayManager` is missing.

- [ ] **Step 3: Implement discovery and persistence matching**

Prefer exact stable-property match, then prior geometry. Return `ambiguous` instead of selecting when candidates tie. Numeric Electron display ID is only an in-session hint.

- [ ] **Step 4: Write failing window-lifecycle tests**

Assert the customer window uses the task-global secure web preferences plus the customer preload, is frame-free/kiosk/skip-taskbar, fills the target bounds, denies navigation/new windows, waits for `ready-to-show`, subscribes after `did-finish-load`, closes on removal, and reopens only after an unambiguous match/operator choice.

- [ ] **Step 5: Implement wired window lifecycle and Identify**

Create a short-lived numbered Identify overlay on the selected display. Register and remove `display-added`, `display-removed`, and `display-metrics-changed` listeners in the manager lifecycle.

- [ ] **Step 6: Run the wired tests and typecheck**

Run: `pnpm exec vitest run apps/operator-desktop/test/wired-display-manager.test.ts && pnpm --filter @odc-photostudio/operator-desktop typecheck`

Expected: tests PASS and typecheck exits 0.

- [ ] **Step 7: Commit**

```powershell
git add apps/operator-desktop/src/main/display/wired-display-manager.ts apps/operator-desktop/test/wired-display-manager.test.ts apps/operator-desktop/src/main/index.ts
git commit -m "feat(display): manage certified wired customer screen"
```

### Task 5: Secure Offline BYOD Tablet Server

**Files:**
- Create: `apps/operator-desktop/src/main/display/tablet-display-server.ts`
- Create: `apps/operator-desktop/src/main/display/private-network.ts`
- Create: `apps/operator-desktop/test/tablet-display-server.test.ts`
- Modify: `apps/operator-desktop/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: Task 1 tablet status/settings and Task 2 broker sink protocol.
- Produces: `listPrivateIpv4Interfaces(): PrivateNetworkInterface[]` and `isPrivateIpv4(address: string): boolean`.
- Produces: `TabletDisplayServer.start(options: { host: string; port: number; rendererRoot: string }): Promise<TabletDisplayStatus>`, `stop(): Promise<void>`, `resetPairing(): TabletDisplayStatus`, `getStatus(): TabletDisplayStatus`, `onStatus(listener): () => void`, and a `DisplaySink` registered only while a paired WebSocket is open.

- [ ] **Step 1: Add the direct WebSocket dependency and write failing network tests**

Add `ws` runtime and `@types/ws` development dependencies. Test acceptance of RFC1918 IPv4 plus loopback for tests; reject public, unspecified, multicast, IPv6, and malformed addresses from selectable production interfaces.

- [ ] **Step 2: Write failing HTTP pairing tests**

Using loopback and an ephemeral test port, assert a 128-bit-or-stronger URL-safe token, 10-minute unused expiry, one-time consumption, `HttpOnly; SameSite=Strict` cookie, redirect to a token-free URL, 12-hour cookie expiry, `Cache-Control: no-store`, CSP, unknown-route 404, path traversal rejection, rate limiting, redacted status, and clean stop/rebind.

- [ ] **Step 3: Write failing WebSocket lifecycle tests**

Assert one-client enforcement, origin/host/cookie validation, initial current-snapshot replay, binary frame envelope, snapshot/frame acknowledgements, heartbeats, reconnect within 5 minutes, forced re-pair after 5 minutes or 12 hours, pairing survival across photo sessions, reset/disable/app-exit invalidation, buffered-byte live-frame dropping, and disconnect when state/preview remains blocked for 2 seconds. Pin JSON messages to `{ "v": 1, "type": "snapshot", "payload": ... }`, `{ "v": 1, "type": "ack_snapshot", "revision": n }`, and `{ "v": 1, "type": "ack_frame", "sequence": n }`.

- [ ] **Step 4: Run the BYOD test and verify failure**

Run: `pnpm exec vitest run apps/operator-desktop/test/tablet-display-server.test.ts`

Expected: FAIL because the private-network and tablet-server modules do not exist.

- [ ] **Step 5: Implement private interface selection and the server**

Use Node `http`, `crypto`, and `os.networkInterfaces()` plus `ws`. Name the cookie `odc_display_pair` with `Path=/; Max-Age=43200; HttpOnly; SameSite=Strict`. Serve only the built renderer allowlist, cap request/header/WebSocket payload sizes, compare secrets with a timing-safe operation, never echo secrets after pairing, and inject clock/token/renderer-root for tests. Generate the operator-only QR PNG through the existing `generateHighContrastQrBuffer` helper; clear `pairingUrl` and `pairingQrDataUrl` from status immediately after pairing.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `pnpm exec vitest run apps/operator-desktop/test/tablet-display-server.test.ts && pnpm --filter @odc-photostudio/operator-desktop typecheck`

Expected: tests PASS and typecheck exits 0.

- [ ] **Step 7: Commit**

```powershell
git add apps/operator-desktop/src/main/display/tablet-display-server.ts apps/operator-desktop/src/main/display/private-network.ts apps/operator-desktop/test/tablet-display-server.test.ts apps/operator-desktop/package.json pnpm-lock.yaml
git commit -m "feat(display): add secure offline tablet pairing"
```

### Task 6: Operator Display Controls and Validated IPC

**Files:**
- Create: `apps/operator-desktop/src/renderer/display-settings/DisplaySettingsPanel.tsx`
- Create: `apps/operator-desktop/src/renderer/display-settings/display-settings.css`
- Modify: `apps/operator-desktop/src/preload/index.ts:1-110`
- Modify: `apps/operator-desktop/src/renderer/store.ts:10-490`
- Modify: `apps/operator-desktop/src/renderer/App.tsx:1-920`
- Modify: `apps/operator-desktop/src/main/index.ts:35-203`
- Create: `apps/operator-desktop/test/customer-display-operator-controls.test.tsx`
- Modify: `apps/operator-desktop/test/operator-desktop-wiring.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 4, and 5 settings/status/manager/server APIs.
- Produces operator bridge methods: `getDisplayOverview()`, `saveDisplaySettings(settings)`, `identifyDisplay({ fingerprint })`, `openWiredDisplay({ fingerprint })`, `closeWiredDisplay()`, `startTabletDisplay({ host, port })`, `stopTabletDisplay()`, `resetTabletPairing()`, `onDisplayStatus(listener)`, and `resetCustomerSession()`.
- Produces store actions with the same intent plus `refreshDisplayOverview()`; components never call raw IPC.

- [ ] **Step 1: Write failing bridge/store tests**

Extend the bridge mock and assert every request is schema-validated, no secret is logged, status subscriptions unsubscribe, mode/config persists, reset session is sent by **Start Next Session**, and display errors do not change capture/print state.

- [ ] **Step 2: Run the wiring test and verify failure**

Run: `pnpm exec vitest run apps/operator-desktop/test/operator-desktop-wiring.test.ts`

Expected: FAIL because the display bridge methods/actions do not exist.

- [ ] **Step 3: Implement validated main/preload/store APIs**

Reuse `safeHandle`, validate every invoke with Task 1 schemas, and expose status events through fixed allowlisted channels. Never expose a generic `send`, `invoke`, filesystem, or network primitive.

- [ ] **Step 4: Write failing operator-panel tests**

Test mode choices, wired target list and Identify/Use actions, ambiguous/missing warning, BYOD interface/port selection, QR image/URL visibility only while awaiting pairing, connected/reconnecting/error copy, stop/reset actions, diagnostics values, keyboard accessibility, and text labels in addition to color.

- [ ] **Step 5: Implement the operator panel**

Mount it as a focused settings drawer/section without restructuring unrelated capture UI. Reuse the existing dark palette and spacing; display “Certified” only for the wired mode and a network-quality caveat for BYOD.

- [ ] **Step 6: Run focused tests and build**

Run: `pnpm exec vitest run apps/operator-desktop/test/operator-desktop-wiring.test.ts apps/operator-desktop/test/customer-display-operator-controls.test.tsx --environment jsdom && pnpm --filter @odc-photostudio/operator-desktop build`

Expected: tests PASS and desktop build exits 0.

- [ ] **Step 7: Commit**

```powershell
git add apps/operator-desktop/src/renderer/display-settings apps/operator-desktop/src/preload/index.ts apps/operator-desktop/src/renderer/store.ts apps/operator-desktop/src/renderer/App.tsx apps/operator-desktop/src/main/index.ts apps/operator-desktop/test/operator-desktop-wiring.test.ts apps/operator-desktop/test/customer-display-operator-controls.test.tsx
git commit -m "feat(display): add operator display controls"
```

### Task 7: Runtime Integration with Camera and Session Lifecycle

**Files:**
- Create: `apps/operator-desktop/src/main/display/customer-display-runtime.ts`
- Modify: `apps/operator-desktop/src/main/orchestrator.ts:300-490`
- Modify: `apps/operator-desktop/src/main/index.ts:35-370`
- Modify: `apps/operator-desktop/src/renderer/store.ts:212-480`
- Create: `apps/operator-desktop/test/customer-display-runtime.test.ts`
- Modify: `apps/operator-desktop/test/hardware-and-packaging.test.ts:200-390`

**Interfaces:**
- Consumes: Task 2 coordinator/broker, Task 4 wired manager, Task 5 tablet server, existing `ICameraProvider.startLiveView/stopLiveView`, and `StationOrchestrator.captureFrame`.
- Produces: `CustomerDisplayRuntime.initialize(): Promise<void>`, `captureFrame(params: TriggerCaptureIpcRequest): Promise<CaptureIpcResult>`, `approveSession(sessionId: string): Promise<ApproveIpcResult>`, `resetSession(): void`, `getOverview(): DisplayOverview`, and `close(): Promise<void>`.
- Produces: `StationOrchestrator.getTemplateRequiredShotCount(eventId: string, templateVersionId: string): number` using the already validated cached event package.

- [ ] **Step 1: Write failing runtime integration tests**

With `MockCameraProvider` and fake wired/tablet sinks, assert one live-view producer for one or two consumers, no producer with zero consumers, start-session `live`, exact countdown before orchestrator capture, actual captured JPEG used for preview, preview clearing, `review` after the last slot, `complete` after approval, and `idle` after reset.

- [ ] **Step 2: Add race/disconnect regression tests**

Assert a second capture during countdown returns `DISPLAY_CAPTURE_BUSY`; reset cancels a pre-shutter countdown; session replacement after shutter start is rejected; wired removal/tablet disconnect during countdown does not cancel or duplicate capture; camera failure enters `recovering` while preserving captured slots; display failures never block approval, print, sync, or the next session.

- [ ] **Step 3: Run the runtime test and verify failure**

Run: `pnpm exec vitest run apps/operator-desktop/test/customer-display-runtime.test.ts`

Expected: FAIL because `CustomerDisplayRuntime` and required-shot lookup are missing.

- [ ] **Step 4: Implement required-shot lookup and runtime composition**

Keep orchestration authoritative in main. Read preview bytes only from `CaptureResult.localFilePath`, immediately publish them, and clear the buffer according to the coordinator lifecycle. Do not return file paths over IPC or WebSocket.

- [ ] **Step 5: Route existing IPC through the runtime and close cleanly**

Wire bootstrap after camera initialization, call runtime capture/approve/reset methods, publish initial status after windows load, and await `runtime.close()` before camera/database/application shutdown. Preserve existing IPC result shapes unless Task 1 contracts explicitly add fields.

- [ ] **Step 6: Extend camera tests for one-producer lifecycle**

Assert repeated first-consumer events do not start duplicate timers/processes and final-consumer grace stop calls `stopLiveView` exactly once. Preserve existing abort/disconnect tests.

- [ ] **Step 7: Run desktop and regression suites**

Run: `pnpm exec vitest run apps/operator-desktop/test/customer-display-runtime.test.ts apps/operator-desktop/test/hardware-and-packaging.test.ts apps/operator-desktop/test/operator-desktop-wiring.test.ts apps/operator-desktop/test/station-enrollment-and-plan-limits.test.ts`

Expected: all tests PASS with no open handles.

- [ ] **Step 8: Commit**

```powershell
git add apps/operator-desktop/src/main/display/customer-display-runtime.ts apps/operator-desktop/src/main/orchestrator.ts apps/operator-desktop/src/main/index.ts apps/operator-desktop/src/renderer/store.ts apps/operator-desktop/test/customer-display-runtime.test.ts apps/operator-desktop/test/hardware-and-packaging.test.ts
git commit -m "feat(display): integrate customer display runtime"
```

### Task 8: Windows Firewall Lifecycle and Operational Qualification

**Files:**
- Create: `apps/operator-desktop/build/installer.nsh`
- Modify: `apps/operator-desktop/electron-builder.json:1-45`
- Modify: `docs/hardware-and-operations-runbook.md`
- Create: `docs/customer-display-qualification-template.md`
- Modify: `README.md`
- Modify: `apps/operator-desktop/test/hardware-and-packaging.test.ts`

**Interfaces:**
- Consumes: packaged executable name, TCP port `47940`, and Task 6 diagnostics copy.
- Produces: NSIS install/uninstall macros that add/remove exactly one Windows Defender Firewall inbound rule for the packaged executable and TCP `47940` on Private profiles only.
- Produces: repeatable wired/BYOD qualification evidence fields and recovery instructions.

- [ ] **Step 1: Write failing packaging assertions**

Add source-level packaging tests asserting `electron-builder.json` includes the custom NSIS script, install adds an executable-scoped inbound TCP `47940` Private-profile rule, uninstall removes the same named rule, no Public/Any profile rule exists, and development startup contains no automatic firewall mutation.

- [ ] **Step 2: Run the packaging test and verify failure**

Run: `pnpm exec vitest run apps/operator-desktop/test/hardware-and-packaging.test.ts`

Expected: FAIL because the custom firewall lifecycle is absent.

- [ ] **Step 3: Implement the NSIS firewall lifecycle**

Use the existing elevation consent. Name the rule `ODC-PhotoStudio BYOD Display (Private)` consistently for install, upgrade replacement, and uninstall cleanup. Scope it to the installed executable, TCP `47940`, inbound allow, Private profile only. Leave non-default ports closed and show their exact manual rule in diagnostics.

- [ ] **Step 4: Document setup, diagnostics, and rollback**

Update the runbook with Windows Extend setup, display selection, isolated-router topology, iPad Home Screen/Guided Access, Android pinning, pairing/reset, manual development firewall command, disconnect recovery, mode-off rollback, and the warning against venue/public Wi-Fi.

- [ ] **Step 5: Create the physical qualification template**

Require station build, Windows version, DSLR/provider, monitor model/connection, tablet model/OS/browser, router/topology, orientation/aspect ratio, measured live-frame age/fps/drop count, countdown observation, sleep/reconnect results, cable removal stage, offline/WAN-disconnected result, operator initials, date, and evidence links. Default every hardware row to `UNVERIFIED`.

- [ ] **Step 6: Run full automated verification**

Run: `pnpm test && pnpm typecheck && pnpm build`

Expected: all repository tests, typechecks, and builds pass. Warnings may not claim physical hardware certification.

- [ ] **Step 7: Run manual smoke tests before any pilot**

Run the qualification template for mock camera plus wired HDMI, native USB-C DisplayPort, current iPadOS Safari, oldest-supported iPadOS Safari, current Android Chrome, oldest-supported Android Chrome, WAN disconnected, sleep/wake, Wi-Fi interruption, and disconnects during idle/countdown/preview/review.

Expected: every selected release-support row is recorded PASS; otherwise keep display mode default `off` and do not pilot.

- [ ] **Step 8: Commit**

```powershell
git add apps/operator-desktop/build/installer.nsh apps/operator-desktop/electron-builder.json apps/operator-desktop/test/hardware-and-packaging.test.ts docs/hardware-and-operations-runbook.md docs/customer-display-qualification-template.md README.md
git commit -m "docs(display): add deployment and qualification controls"
```

## Integration Order and Handoffs

1. Task 1 freezes contracts and persistence before any process or UI implementation.
2. Task 2 provides the transport-neutral source of truth and backpressure policy.
3. Task 3 builds the customer surface against Tasks 1–2 without requiring hardware.
4. Tasks 4 and 5 may proceed in parallel after Task 3 because each implements one independent transport.
5. Task 6 consumes both transport managers and exposes operator control.
6. Task 7 is the only task allowed to change the live capture/session lifecycle; it integrates all prior contracts.
7. Task 8 packages and qualifies the already-integrated behavior; it does not change capture semantics.

Each task must be reviewed and green before its dependent task begins. Do not combine Tasks 4 and 5 into one review: wired correctness must remain independently shippable if BYOD qualification is delayed.

## Release Gates and Rollback

- Keep `DisplaySettings.mode = 'off'` in defaults and existing station databases until all automated checks pass.
- Enable `wired` only for internal stations after Windows/display/DSLR physical qualification evidence is attached.
- Enable `tablet`/`both` only after isolated-router iPadOS and Android rows pass and the Private-profile firewall rule is verified on install, upgrade, and uninstall.
- Pilot one station with a wired monitor available as fallback; collect frame age/drop, disconnect, and capture-error diagnostics without image/token data.
- Roll back by setting mode `off`; runtime closes the kiosk/server, invalidates pairing, clears preview bytes, and stops live view after the 5-second consumer grace. No cloud, Supabase, or schema rollback is required.
- If any display failure affects capture, approval, print, upload, or next-session behavior, disable the feature and treat it as a release blocker rather than adding an operator workaround.
