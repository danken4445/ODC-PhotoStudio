# Customer Display Operating Modes Design

**Date:** 2026-10-19  
**Status:** Approved direction  
**Product:** ODC-PhotoStudio Operator Desktop

## Intent

ODC-PhotoStudio needs a customer-facing display that behaves like a mirror of the tethered DSLR point of view while the operator retains private control of the session. The display must add the timing and feedback expected from a commercial photobooth: framing guidance, a visible countdown, shot progress, shutter feedback, short previews, completion messaging, and recoverable error states.

The product will support two standard operating modes from one customer-display experience:

1. **Certified Wired Display** for the most predictable offline operation and lowest transport latency.
2. **Bring Your Own Tablet (BYOD)** for tenants that already own an iPad, Android tablet, or Windows tablet.

The wired mode is the qualification baseline. BYOD is a supported compatibility mode with an explicit device/browser qualification matrix; it is not presented as equivalent to a direct cable for latency or operational certainty.

## Goals

- Show the DSLR live-view feed horizontally mirrored on the customer display while leaving captured files unmirrored.
- Keep all operator controls, enrollment information, print controls, diagnostics, and gallery secrets off the customer display.
- Work without internet access after station preparation.
- Use one display state model and one customer UI for both wired and BYOD transports.
- Keep preview latency bounded by dropping obsolete frames instead of queueing them.
- Synchronize countdown, capture, preview, review, completion, and recovery states from the Electron main process.
- Let an operator configure, identify, start, stop, pair, and diagnose displays from the existing operator console.
- Preserve capture and print operation if either customer display disconnects.
- Avoid sending live-view or captured images to Supabase, the tenant portal, or any third-party service.

## Non-goals

- Turning the customer display into a second operator console.
- Allowing a customer to approve, retake, print, or change templates from the display in the first release.
- Replacing the existing DSLR provider or promising physical camera compatibility that has not been qualified.
- Automating the entire multi-shot sequence; each existing operator capture action still starts one countdown and one shutter release.
- Streaming over the public internet or venue cloud Wi-Fi.
- Shipping a native iOS or Android application.
- Guaranteeing every historical tablet/browser combination. The documented support floor must be physically qualified before release.
- Adding tenant branding, decorative non-functional animations, audio prompts, or multilingual copy in the first release. Functional overlay animations (countdown, shutter flash, framing/status) remain active and are designed to be flashy and modern.

## Operating Modes

### Certified Wired Display

The DSLR remains USB-tethered to the Windows booth PC. A portable monitor connects to the PC through native HDMI or USB-C DisplayPort Alt Mode and Windows is configured to extend the desktop. Electron discovers displays through the `screen` API and opens a dedicated, frame-free kiosk `BrowserWindow` on the selected external display.

The wired window loads a customer-only renderer surface with a read-only preload. It receives display snapshots and bounded JPEG frames directly from the main process. It never receives the operator preload API.

The station remembers a display fingerprint made from stable properties available from Electron (label, size, scale factor, and rotation) rather than trusting a transient numeric display ID alone. If the preferred display is absent, the customer window remains closed and the operator sees a warning with an explicit replacement-display choice. Hot-plug events refresh the list without interrupting camera, capture, print, or sync work.

### Bring Your Own Tablet

The booth PC hosts a small local HTTP/WebSocket companion service on a fixed configurable port, default `47940`. The service is disabled until the operator explicitly enables BYOD for the station. It serves only the bundled customer renderer and the customer-display stream; it has no route to station files, cloud credentials, operator APIs, or the local database.

The recommended network is a booth-owned, isolated dual-band router with the booth PC connected by Ethernet and the tablet connected over 5 GHz Wi-Fi. The service does not require WAN access. Venue or public Wi-Fi is allowed only with a visible degraded-security/reliability warning and is not part of certified qualification.

Enabling BYOD generates a cryptographically random 128-bit-or-stronger pairing token and a QR URL using a selected private IPv4 interface. The landing request consumes that token, sets an ephemeral `HttpOnly`, `SameSite=Strict` session cookie, and redirects to a token-free display URL. One tablet session is accepted at a time. The operator can revoke the session or rotate the token. A reconnect grace period allows the same paired tablet to recover from a brief sleep or Wi-Fi interruption.

The unused pairing token expires after 10 minutes. The paired cookie has a 12-hour hard lifetime and otherwise ends when BYOD is disabled, the operator resets pairing, the application exits, or the hard lifetime is reached. Completing an individual photo session does not unpair the tablet because one device serves many customers during an event. A disconnected tablet may reclaim its pairing for 5 minutes; after that grace period the operator must display a new QR code and pair again.

The tablet can run in Safari/Chrome or be added to the Home Screen. Guided Access or the Android equivalent is an operational recommendation, not an application dependency. The page must not require camera, microphone, location, Bluetooth, notifications, or persistent-storage permission.

### Combined Mode

`both` is a valid station mode. The wired window and one paired tablet may show the same customer state concurrently. Neither is authoritative; the main-process coordinator is the single source of truth.

## Display Experience

The first release uses these phases:

| Phase | Customer presentation |
| --- | --- |
| `idle` | Dark branded holding screen: “Step into frame” |
| `live` | Mirrored live view, subtle framing guide, “Look at the camera”, and shot progress |
| `countdown` | Live view remains visible with a centered, flashy and modern `3`, `2`, `1` overlay |
| `capturing` | Short white shutter flash; input remains non-interactive |
| `preview` | The just-captured still appears unmirrored for 2 seconds with current shot progress |
| `review` | All required shots are captured; customer is told the attendant is reviewing them |
| `complete` | Session approved: “All done — thank you!” |
| `recovering` | Live view is unavailable or a display transport is reconnecting: “One moment — your attendant is helping” |

The capture countdown defaults to 3 seconds. The source of truth is the main process, which schedules the shutter only after publishing countdown state. Retakes use the same sequence. Captured stills are displayed in their saved orientation and are not mirrored.

The exact lifecycle is:

1. Application start or **Start Next Session** with no active session: `idle`.
2. Successful session creation: `live`.
3. Accepted capture or retake command: `countdown` with `3`, `2`, `1`.
4. Countdown completion: `capturing`, immediately followed by the orchestrator shutter call.
5. Successful capture: `preview` for 2 seconds, then `review` if all required slots are filled or `live` otherwise.
6. Successful approval: `complete`.
7. Start Next Session or cancellation: clear preview bytes and return to `idle`.
8. Camera/live-view failure: `recovering`; after camera readiness returns, restore `live` for an active session or `idle` without one.

Only one capture sequence may exist at a time. A second capture/retake request during countdown or shutter execution is rejected with `DISPLAY_CAPTURE_BUSY`. The sequence is bound to the active session generation. Starting another session or cancelling during countdown aborts the timers before shutter release; session changes are rejected once shutter execution has begun. Camera failure preserves previous shots, clears countdown state, and enters `recovering`. Preview bytes are cleared after the 2-second preview, on review/complete/reset/cancel, when all display modes are disabled, and during shutdown.

The UI is responsive from 4:3 through 16:9 and supports portrait or landscape tablets. The photograph uses `object-fit: contain`, with neutral letterboxing rather than cropping. Text and progress indicators stay inside safe margins. Status is always communicated by text and shape, not color alone. Overlay animations (3-2-1 countdown scale-in/pop, pulse/glow effects, sleek backdrop blurs, and shutter flash) are flashy and modern, while respecting `prefers-reduced-motion` with subtle, instant transitions. The display contains no actionable controls.

## Shared State and Transport Contract

`packages/contracts/src/display.ts` owns runtime-validated contracts shared by main, preload, and renderer:

- `DisplayMode = 'off' | 'wired' | 'tablet' | 'both'`
- `CustomerDisplayPhase = 'idle' | 'live' | 'countdown' | 'capturing' | 'preview' | 'review' | 'complete' | 'recovering'`
- `CustomerDisplaySnapshot` containing `revision`, `phase`, `shotIndex`, `shotCount`, `countdownValue`, `message`, `mirroredLiveView`, `updatedAt`, and the latest frame/preview sequence identifiers.
- `DisplayTarget` containing the operator-safe display fingerprint and geometry needed for selection.
- `TabletDisplayStatus` containing enabled/listening/paired state, private bind address, port, safe pairing URL, and last heartbeat time; tokens and cookies are never returned after pairing.

State updates and frame bytes travel separately. Snapshots are small JSON messages. JPEG frames are binary envelopes containing a frame kind (`live` or `preview`), monotonically increasing sequence number, capture timestamp, and bytes. A sink may have at most one unacknowledged live frame. New live frames replace unsent frames; preview frames and state transitions are never displaced by live frames.

Each sink keeps only the latest snapshot, at most one preview, and at most one live frame. Snapshot updates coalesce to the newest revision. Preview has priority over live data. If a sink cannot accept the latest snapshot or preview within 2 seconds, disconnect that sink rather than stall capture or grow memory. A reconnect receives the current snapshot and current preview only if the preview phase is still active.

The camera provider starts one live-view producer. The display coordinator fans the newest frame to the wired and tablet transports. It does not start a second camera stream per display.

## Process Boundaries

### Main process

- Owns camera live view, countdown timing, customer-display state, frame sequencing, pairing, WebSocket connections, display discovery, and kiosk window lifecycle.
- Reads captured still bytes only from the trusted path returned by the camera/orchestrator boundary.
- Stops live view and closes display transports during orderly shutdown.

### Operator renderer

- Requests display status and configuration over the existing context-isolated preload bridge.
- Selects a wired target, opens/closes the wired display, enables/disables BYOD, selects a private network interface, shows pairing QR/status, and resets pairing.
- Shows actionable warnings without blocking capture solely because a customer display is absent.

### Customer renderer

- Receives only display snapshots and image frames.
- Converts each JPEG to a short-lived blob URL, revokes the previous URL immediately, and holds no history.
- Applies mirroring only to live-view pixels.
- Runs without Node integration and cannot navigate or open new windows.

### Cloud systems

No changes are required to Supabase, the web portal, tenant APIs, or gallery storage. Customer-display pairing and media are local station concerns.

## Security and Privacy

- Keep Electron `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, and navigation/window-open denial on both desktop windows.
- Use a separate read-only customer preload; do not reuse `odcOperatorBridge`.
- Default the BYOD server to disabled and persist only mode/configuration, never pairing tokens.
- Accept only private/loopback bind addresses selected from local interfaces; reject public addresses by default.
- Require the one-time high-entropy pairing URL before issuing a session cookie.
- Allow one paired tablet and bound reconnect grace; reject additional clients until the operator resets pairing.
- Set `Cache-Control: no-store`, omit service workers and browser persistence, revoke blob URLs, and clear in-memory preview bytes when the phase changes or a session ends.
- Apply a strict customer-page CSP and reject unexpected `Origin`, `Host`, route, payload size, and WebSocket message types.
- Rate-limit pairing attempts and cap WebSocket buffered bytes and JPEG payload sizes.
- Never log pairing tokens, cookies, image bytes, gallery tokens, or local file paths.
- Document that unencrypted local HTTP/WebSocket traffic is acceptable only on the isolated booth LAN. Public venue networks are not certified because locally trusted TLS without device provisioning would reintroduce iOS certificate friction.

## Reliability and Performance

- Target one 1280×720-or-smaller JPEG live frame at 10–15 fps; the actual rate remains bounded by the qualified camera driver.
- Never allow live frames to queue without bound. If a sink is busy or a tablet WebSocket exceeds the configured buffered-byte ceiling, skip that live frame.
- Keep snapshots monotonic by `revision` and frames monotonic by `sequence`; renderers discard older data.
- A wired-display disconnect closes only that window and reports `disconnected` to the operator.
- A tablet disconnect changes its status to reconnecting/available-for-reconnect without affecting capture.
- If the camera live view stops, display `recovering`; already captured assets and session state remain untouched.
- A failed BYOD bind (port conflict, firewall, or missing private interface) is reported as an operator action, not a fatal application error.
- The application remains usable with display mode `off`.

The camera live-view producer runs only while at least one customer-display consumer is ready: a wired window has finished loading or a tablet is paired and connected. It starts for the first consumer and stops 5 seconds after the last consumer leaves, preventing rapid reconnect churn while limiting camera heat and CLI work. Countdown and still capture remain main-process operations and do not depend on a display consumer staying connected.

The existing real camera adapter shells out and writes a temporary JPEG for every preview frame. The first release wires that stream correctly and instruments frame age/drop counts. Replacing the CLI preview loop with a qualified vendor SDK stream is a later hardware-specific optimization and must not be represented as completed by this feature.

## Operator Configuration and Diagnostics

Add a **Customer Display** panel to the operator console with:

- Mode selection: Off, Certified Wired, BYOD Tablet, or Both.
- Detected wired displays with Identify and Use This Display actions.
- Wired state: connected, opening, active, missing, or error.
- BYOD state: stopped, listening, awaiting pairing, connected, reconnecting, or error.
- Private network interface selection, local URL, pairing QR, reset pairing, and stop controls.
- Current measured frame rate, dropped-frame count, last frame age, and last tablet heartbeat.
- Clear copy that the wired display is certified and BYOD quality depends on the local tablet/network.

Configuration values use the existing local `station_config` key/value store. Pairing credentials and transient connection state remain memory-only.

Persist the wired choice as a composite record containing Electron’s current display ID as a hint plus label, bounds, size, scale factor, rotation, and internal/external status. Match all stable properties first, then the prior geometry. If more than one connected display is still an equally good match, do not guess: leave the wired window closed, mark selection ambiguous, and require the operator to use Identify and select the target again.

## Testing and Qualification

Automated coverage must include:

- Contract validation and rejection of malformed display settings/snapshots.
- Main-process countdown order and shutter timing, including retakes and camera failure.
- Latest-frame-wins behavior and bounded memory for slow wired/tablet sinks.
- Display discovery, preferred-target recovery, hot-plug, removal, and no-secondary-display behavior using injected Electron adapters.
- BYOD token consumption, cookie issuance, single-client enforcement, reconnect grace, rate limits, origin/host checks, payload caps, and `no-store` headers.
- Preload API allowlisting and cleanup of event listeners.
- Customer view-model mapping for every phase, mirror rules, stale revision/frame rejection, and blob URL cleanup.
- Existing capture, approval, print, sync, enrollment, and plan-limit suites remaining green.

Release qualification requires a physical matrix because automated tests cannot prove display hardware, DSLR preview, Windows firewall, or Safari lifecycle behavior:

- Windows 11 x64 with one HDMI display and one native USB-C DisplayPort display.
- Cable removal/reconnect during idle, countdown, preview, and review.
- One currently supported iPadOS Safari device plus one oldest-supported iPadOS device defined by the release support policy.
- One currently supported Android Chrome tablet plus one oldest-supported Android device defined by the release support policy.
- Dedicated router with WAN disconnected; tablet sleep/wake; app switching; Wi-Fi interruption/reconnect.
- Mock camera and each physically qualified DSLR provider.
- Portrait and landscape at 4:3, 16:10, and 16:9.

No hardware mode is marked certified until this matrix records model, OS/browser version, connection, measured frame age, countdown behavior, and pass/fail evidence.

The Windows installer adds an inbound TCP rule for the packaged operator executable and default BYOD port `47940` on **Private** network profiles only, using the installer’s existing elevation consent, and removes that rule on uninstall. It must never open a Public-profile rule. A non-default port is an advanced, non-certified configuration and the operator diagnostics panel must report the exact manual Private-profile rule required. Development and portable runs do not mutate firewall state automatically.

## Rollout and Rollback

Ship behind a station-local feature flag defaulting to `off`. Roll out in this order:

1. Internal mock-camera validation with wired display.
2. Physical DSLR plus wired display qualification.
3. Internal isolated-router BYOD validation on iPadOS and Android.
4. One-station tenant pilot with wired as the documented fallback.
5. Broader enablement only after event logs show no capture regressions or unbounded frame behavior.

Rollback is configuration-only: set display mode to `off`, stop the local companion server, close the kiosk window, and stop live view if no consumer remains. Capture, approval, print, upload, and gallery workflows continue unchanged. No database migration rollback or cloud cleanup is required.

## Builder Decisions Left Open

- Exact visual styling and subtle transitions, provided the phase copy, accessibility, safe margins, and performance limits above remain intact.
- The injected adapter shapes used to unit-test Electron `screen` and `BrowserWindow`, provided production code uses Electron’s native APIs.
- The specific WebSocket server package, provided it supports Node 22/Electron 34, binary frames, payload limits, heartbeat handling, and clean shutdown.
- The final supported iPadOS/Android version floor, which must be set from the devices available for physical release qualification rather than inferred from desktop browser support.
