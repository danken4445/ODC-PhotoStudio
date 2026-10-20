# Template Customization Engine (Template Studio)

Status: Phase 1 proposal — architecture and shared schema finalized; implementation stops here for review.

## Intent

Template Studio gives a tenant’s owner or manager a safe way to author a print
layout once, publish an immutable version, assign that exact version to an event,
and let an enrolled station render it offline. The browser editor and station
renderer consume the same versioned definition and integer layout rules. A station
never edits a template and never prints an unverified definition or asset.

The repository already has a legacy `packages/contracts` template shape used by
the current offline-grant flow. Phase 1 introduces `@odc-photostudio/template-schema`
as the canonical authoring/publish contract without changing that live flow. A
later migration phase will bridge the old shape deliberately and remove the
legacy path only after compatibility tests pass.

## Goals

- Define strict Zod schemas and inferred TypeScript types for templates, versions,
  assets, layers, and publishable definitions.
- Keep all coordinates and opacity values integer or fixed-point so browser and
  station implementations make the same rounding decisions.
- Make schema versioning explicit and expose a pure migration entry point.
- Generate JSON Schema from the Zod source so API validation and tooling do not
  drift from the runtime contract.
- Preserve tenant boundaries, immutable published versions, offline asset
  verification, and the existing owner/admin/operator role model.

## Non-goals for Phase 1

- No dashboard editor or asset upload UI.
- No hashing, canonicalization, signing, or renderer implementation.
- No database migration or API route mutation.
- No station sync or print queue changes.
- No claim that Supabase/RLS or physical printer behavior has been verified.

## Repository boundaries

```text
packages/
  template-schema/              # Phase 1: canonical Zod/types/JSON Schema/migrations
  template-engine/              # Phase 2: pure canonicalization/hash/validation/layout
  template-renderer/            # Phase 4/5: web and desktop/RN render adapters
  contracts/                    # Existing session/offline contracts; compatibility bridge
apps/
  web-portal/                   # Dashboard Template Studio and tenant API routes
  operator-desktop/             # Existing offline station surface and print adapter
  api/                          # Reserved boundary if API is split from web-portal
supabase/
  migrations/                   # Phase 3 additive schema and immutability enforcement
  tests/                        # Tenant/RLS/publish/assignment acceptance tests
docs/
  superpowers/specs/            # Design and acceptance documentation
```

The requested React Native station can be added as a client of the same packages;
this checkout currently has an Electron operator desktop. The desktop remains the
station implementation boundary until a separate RN app exists.

## Data ownership and flow

```text
Dashboard draft
    │ autosave (mutable, tenant-scoped)
    ▼
Server publish transaction
    ├─ shared schema validation
    ├─ token and asset validation
    ├─ canonical definition + sorted asset hashes
    ├─ SHA-256 content hash
    └─ optional Ed25519 signature
    ▼
Immutable template version ── pinned by event ── granted to station
                                                    │
                                  download + hash verification
                                                    ▼
                              offline render + print-time verification
```

The database stores the definition and asset manifest as immutable published
records. Asset bytes live in tenant-scoped private storage. The station stores
metadata in its durable local database and asset bytes in its app sandbox. Every
cache lookup includes the tenant and content hash; a hash match alone is not a
tenant authorization decision.

## Schema decisions

### Template and version lifecycle

- `Template` is the stable logical identity and has a tenant/client owner.
- Draft content is mutable and autosaved against that identity.
- `TemplateVersion` is a published snapshot. Its `definition`, `assets`,
  `contentHash`, publisher, and publication timestamp are write-once.
- Events pin a `templateVersionId`; they never resolve a template by “latest”.
- Archive hides a template from new assignment but retains version hashes and
  audit references. Asset purging is handled by the existing lifecycle policy.

### Deterministic numbers

- Canvas coordinates, dimensions, rotations, font size, corner radius, cut lines,
  and shot indices are integers.
- Opacity and focal points use a fixed-point scale of 10,000.
- `dpi` is fixed at 300 in schema version 1.
- The engine will define the remaining rounding rule in Phase 2; adapters may not
  perform independent layout math.

### Assets

An `AssetRef` contains the server-authoritative SHA-256, byte size, MIME type,
tenant-independent asset id, and image metadata when applicable. Image layers
require dimensions. Font layers accept only embedded TTF, OTF, or WOFF2 assets.
The server recomputes the hash on upload and publish; client-provided hashes are
claims to compare, not authority.

### Tokens

Schema validation does not execute token content. Phase 2 will scan text content
against the exact whitelist:

```text
{{event.name}}  {{event.date}}  {{session.number}}  {{client.name}}
```

Unknown tokens fail publish. At print time, values come from local event/session
data and are never interpreted as code or queried from guest free text.

## API and authorization boundary for Phase 3

The API will expose the requested template, asset, publish, pin, and station-sync
operations under the tenant-scoped web portal. Owner and manager/admin roles may
create, edit drafts, publish, archive, and pin versions. Staff/operator roles may
read assigned versions only. Every request carries an authenticated tenant
context; route parameters are not trusted as tenant authorization.

Publish uses an idempotency key and a transaction that validates the draft,
checks the plan limit, creates the next monotonically increasing version, writes
the audit event, and commits the immutable record. Database policies/triggers
reject updates or deletes to published version fields even if application code is
bypassed.

## Tier configuration

The existing `packages/contracts/src/plans.ts` catalogue remains the single source
of truth. Phase 3 will add Template Studio limits there, with these names:

- `maxTemplates`
- `maxLayersPerTemplate`
- `allowCustomFonts`
- `maxQrLayersPerTemplate`

The server enforces limits at create, draft-save, asset attach, and publish time.
The dashboard only mirrors the decision and presents an upgrade prompt; it is not
the security boundary.

## Phase 1 acceptance checks

- `@odc-photostudio/template-schema` exports Zod schemas and inferred types.
- Invalid layer ids, non-integer geometry, unknown layer types, cross-canvas
  frames, invalid asset/MIME combinations, duplicate layers, and duplicate
  version assets are rejected.
- JSON Schema exports are generated from the Zod schemas.
- `migrateTemplateDefinition` is pure, rejects unknown schema versions, and does
  not mutate its input.
- Existing `packages/contracts` and `packages/template-engine` consumers remain
  unchanged in this phase.
- Targeted package typecheck and tests pass; full Supabase/runtime validation is
  explicitly deferred to later phases.

## Open risks carried forward

1. The current repository uses Electron rather than React Native; adapter naming
   and Skia integration must be finalized when the station target is introduced.
2. Existing legacy template rows contain a single overlay path/hash and need an
   additive data migration before multi-asset versions can be published.
3. RFC 8785/JCS support and native-backed hashing must be selected and tested in
   Phase 2 without putting crypto implementations in UI code.
4. Font shaping and text line wrapping may differ across web and desktop/RN; the
   shared renderer contract needs a golden fixture policy in Phase 5/6.
5. Supabase remote migration state and production RLS have not been inspected or
   changed in Phase 1.

## Library note

`zod-to-json-schema` is added only to generate JSON Schema from the canonical Zod
definitions and prevent a manually maintained second schema from drifting. A
handwritten JSON Schema export was considered but rejected because it would create
two sources of truth.
