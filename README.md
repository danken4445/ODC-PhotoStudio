# ODC-PhotoStudio

Commercial, multi-tenant DSLR photobooth platform with an offline-first **Operator Capture Console** (Electron, React, TypeScript, SQLite, Sharp) and an expiring **Customer Gallery & Tenant Portal** (Next.js App Router, Supabase PostgreSQL/Storage, Row-Level Security).

---

## Architecture & Repository Layout

- [`packages/contracts`](file:///g:/Projects/ODC-PhotoStudio/packages/contracts/src/index.ts): Runtime-validated Zod schemas, 5 independent state track transition guards (`capture`, `composite`, `print`, `upload`, `deletion`), SHA-256 token hashing, redaction utilities, Ed25519 offline grant signing/verification, and versioned API/IPC contracts.
- [`packages/template-engine`](file:///g:/Projects/ODC-PhotoStudio/packages/template-engine/src/index.ts): Deterministic geometry (`CLIP_BEFORE_ROTATION_AROUND_SLOT_CENTER`), sRGB normalization, EXIF stripping, high-contrast QR code generation (4-module minimum quiet zone), Sharp compositor, and 2×6-on-4×6 print imposition.
- [`apps/operator-desktop`](file:///g:/Projects/ODC-PhotoStudio/apps/operator-desktop/src/main/orchestrator.ts):
  - `src/main/db.ts`: Synchronous transactional SQLite database (`StationDatabase`) with single-instance station lock, state transition audit logs, durable upload queue, and print attempt tracking.
  - `src/main/camera/provider.ts`: `ICameraProvider` contract, `MockCameraProvider` hardware simulator, and `UnqualifiedRealCameraProvider` boundary.
  - `src/main/printer/provider.ts`: `IPrinterProvider` contract and `MockPrinterProvider` spooler simulator.
  - `src/main/queue/sync-engine.ts`: `DurableSyncEngine` with startup reconciliation, local 24-hour retention cleanup, lease recovery, exponential backoff with jitter (capped at 5 minutes), and 3-step cloud publication (`register` -> `upload` -> `finalize`).
  - `src/preload/index.ts` & `src/renderer/`: Context-isolated preload bridge and Dark Studio operator UI (`#09090B` / `#18181B` / `#27272A` / `#FAFAFA`) with keyboard shortcuts (`Space`, `1-9`, `P`).
- [`apps/web-portal`](file:///g:/Projects/ODC-PhotoStudio/apps/web-portal/src/lib/cloud-service.ts): Next.js App Router tenant portal, customer gallery (`/g/[token]`) with bounded polling, and `CloudPortalService` enforcing tenant isolation, RBAC, 24-hour expiration, capped 60-second download URLs, and 5-minute scheduled deletion sweeps.
- [`supabase/migrations`](file:///g:/Projects/ODC-PhotoStudio/supabase/migrations/20261018000001_initial_schema_and_rls.sql): PostgreSQL schema with composite same-tenant foreign keys and Row-Level Security (RLS) policies.
- [`supabase/tests/acceptance-suite.test.ts`](file:///g:/Projects/ODC-PhotoStudio/supabase/tests/acceptance-suite.test.ts): Automated test suite verifying Acceptance Criteria **A01 through A23**, including a full 500-session event simulation with mid-event restart.
- [`docs/architecture-decisions.md`](file:///g:/Projects/ODC-PhotoStudio/docs/architecture-decisions.md) & [`docs/hardware-and-operations-runbook.md`](file:///g:/Projects/ODC-PhotoStudio/docs/hardware-and-operations-runbook.md): Architecture Decision Log (ADRs), offline preparation guide, and operator recovery runbook.

---

## Quick Start & Verification Commands

### 1. Install Dependencies
```powershell
pnpm install
```

### 2. Copy Environment Placeholders
```powershell
Copy-Item .env.example .env
```

### 3. Run Full Verification & Acceptance Suite (A01–A23)
```powershell
pnpm test
```

### 4. Run TypeScript Typechecking Across All Workspaces
```powershell
pnpm typecheck
```
