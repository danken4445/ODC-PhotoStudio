# ODC-PhotoStudio — Architecture Decision Log (ADL) & Execution Plan

## 1. Repository Inspection Summary (Phase 0)

- **Initial State**: Empty directory (`g:\Projects\ODC-PhotoStudio`).
- **Toolchain Verified**:
  - OS: Windows x64 (`win32`)
  - Node.js: `v24.15.0`
  - pnpm: `11.25.0`
  - Git: `2.54.0.windows.1`
- **Hardware Status**: Physical DSLR camera and physical thermal dye-sublimation printer are not connected to the development environment. Per specification section 2 & 19:
  - Mock-mode development proceeds unblocked with full simulation of delays, camera disconnects, capture failures, print submission crashes, unknown print outcomes, and upload interruptions.
  - Physical hardware qualification remains explicitly marked **INCOMPLETE / UNVERIFIED ON PHYSICAL HARDWARE** until tested on target camera/printer hardware.

---

## 2. Architecture Decision Log (ADRs)

### ADR-001: Project Naming & Monorepo Boundaries
- **Decision**: Name the platform and workspace **ODC-PhotoStudio** (`@odc-photostudio/*`), structured as a `pnpm` monorepo with strict package boundaries:
  - `packages/contracts`: Runtime Zod validation schemas, state track transition matrices, cryptographic token/grant utilities, and versioned API contracts.
  - `packages/template-engine`: Shared deterministic geometry calculation, slot rotation/crop rules, Sharp-based sRGB image compositor, and QR generator.
  - `apps/operator-desktop`: Electron + React + TypeScript + Vite operator console with durable local state, isolated hardware provider interfaces (`ICameraProvider`, `IPrinterProvider`), background upload worker, and startup reconciliation.
  - `apps/web-portal`: Next.js App Router + TypeScript tenant portal, template editor, authenticated API endpoints, and expiring customer gallery.
  - `supabase/migrations` & `supabase/tests`: Version-controlled PostgreSQL schema, composite same-tenant foreign keys, RLS policies, and storage cleanup logic.

### ADR-002: Five Independent Durable State Tracks
- **Context**: Overloading a single `session.status` field causes race conditions when printing happens concurrently with background cloud uploads or when expiration triggers while an upload is retrying.
- **Decision**: Maintain five independent state tracks (`capture_state`, `composite_state`, `print_state` via audited `print_attempts`, `upload_state`, `deletion_state`) with explicit transition guards and an immutable `state_transitions` audit log recording source state, destination state, timestamp, and redacted reason.

### ADR-003: Durable Local Persistence & Node.js 24 SQLite Compatibility
- **Context**: Node.js `v24.15.0` includes the native synchronous SQLite module (`node:sqlite` `DatabaseSync`) alongside `better-sqlite3` support. Native C++ addons on Windows (`better-sqlite3`) can fail if Visual Studio C++ Build Tools are absent on an unprovisioned machine, whereas transactional synchronous SQLite semantics are mandatory.
- **Decision**: Implement a strict synchronous transactional SQLite storage adapter that supports `better-sqlite3` and seamlessly falls back to Node's built-in synchronous SQLite (`node:sqlite` `DatabaseSync`) with WAL mode, foreign keys enabled, and atomic `BEGIN IMMEDIATE ... COMMIT` transactions. All session manifests, print attempts, state transitions, and upload jobs execute in atomic SQLite transactions.

### ADR-004: Clipping vs. Rotation Order in Template Engine
- **Context**: Spec Section 12 requires specifying whether clipping occurs before or after slot rotation and implementing the exact same rule in both editor and renderer.
- **Decision**: **Clip to slot rectangle first (in slot local coordinates using `fit: 'cover' | 'contain'` and normalized `focalPoint`), then rotate the clipped slot image around the slot center (`rotationDeg`) before compositing beneath the template overlay.** The QR code is placed last in its reserved high-contrast box with a mandatory minimum 4-module quiet zone and verified never to be clipped or covered by the overlay.

### ADR-005: Asymmetric Ed25519 Offline Grants & Bearer Gallery Tokens
- **Decision**:
  - **Gallery Tokens**: 32-byte cryptographically random `base64url` token generated before capture. Stored locally in protected station storage, never logged, and only its SHA-256 hash (`token_hash`) is transmitted to or stored in the cloud database.
  - **Offline Event Grants**: Signed server-side using Ed25519 (`node:crypto`). The desktop app stores only the public verification key and verifies grant signature, tenant/event/station/operator binding, and 72-hour maximum validity window before allowing offline preparation or capture.

### ADR-006: Authoritative Expiration & Clock Tamper Mitigation
- **Decision**:
  - `expires_at = first_successful_capture_at + 24 hours`. Retakes, reprints, and upload retries never extend `expires_at`.
  - During online preparation, the station records `server_time_offset_ms` and monotonic `performance.now()` / `process.hrtime.bigint()` baselines.
  - If wall-clock time jumps backward or diverges significantly from monotonic elapsed time, `clock_warning` is raised: local capture and printing remain available with a visible operator warning, while cloud publication requires server time reconciliation and rejects implausible future timestamps.
