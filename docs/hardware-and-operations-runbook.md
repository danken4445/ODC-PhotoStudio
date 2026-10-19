# ODC-PhotoStudio — Hardware Qualification & Operations Runbook

## 1. Hardware Qualification Status (Section 13 & 19)

| Component | Target | Status | Notes |
| --- | --- | --- | --- |
| Target OS | Windows x64 (`win32` / Node `v24.15.0`) | Qualified (Mock & Local SQLite/Sharp) | Native `sharp` and synchronous SQLite verified on Windows x64 |
| DSLR Camera Provider | `ICameraProvider` (`MockCameraProvider` / Real SDK) | **Mock Qualified / Physical Hardware Pending** | Mock mode verified for live view, capture, disconnect recovery (A02), and retake (A03). Physical Canon EDSDK / Nikon MAID camera hardware is not connected and remains visibly marked unverified. |
| Dye-Sub Printer Provider | `IPrinterProvider` (`MockPrinterProvider` / Windows Spooler) | **Mock Qualified / Physical Hardware Pending** | Mock mode verified for 4×6 (1200×1800) and 2×6 strip imposition onto 4×6 (A22), spooler submission vs. physical confirmation (`Submitted — check printer`), and crash recovery (`Outcome unknown`, A05). Physical printer hardware and phone QR scan on physical media remain pending physical hardware connection. |

---

## 2. How to Distinguish Real vs. Mock Mode (Section 6.1 & 21)

- When `ODC_DESKTOP_MODE="mock"` (or when constructed with `MockCameraProvider` / `MockPrinterProvider`), `evaluatePreflight()` and the Operator Capture Console header display an unmistakable banner:
  - **`SIMULATION / MOCK HARDWARE MODE`**
- Mock printing writes rendered output files (`print-{sessionId}-{attemptId}.jpg`) into the local `prints/` directory without contacting a physical printer.
- Never remove the simulation label or mark a station hardware-certified until physical camera transfer, physical dye-sublimation print dimensions, cutter behavior, camera SD card retention, and Windows print spool retention are verified on the physical target hardware.

---

## 3. Offline Event Preparation Procedure (Section 6.1)

1. Connect the operator desktop station to the internet before the event.
2. Sign in as an active tenant `owner`, `admin`, or an `operator` explicitly assigned to the target event and station.
3. Request the offline event package (`issueOfflineEventGrant` / `prepareEventOffline`):
   - Downloads event configuration, immutable `TemplateDefinition` versions, overlay PNG assets, and `PrintProfile` definitions.
   - Verifies SHA-256 checksums of all overlay assets on disk.
   - Verifies the Ed25519 signature and 72-hour validity window of the `SignedOfflineGrant` using the station's public key.
   - Records `server_time_offset_ms` and monotonic clock baseline.
   - Runs local disk capacity preflight (`expectedSessions * (shotsPerSession * avgShotBytes + compositeBytes) * 1.25`).
4. Confirm the station header displays **`Ready offline`** before disconnecting from the network.

---

## 4. Operator Recovery Runbook (Sections 6.3, 6.5, 7, 9)

### 4.1 Camera Disconnect Mid-Session (Scenario A02)
- **Symptom**: Camera disconnects during a multi-shot sequence; capture halts and displays `Camera: Disconnected`.
- **Automatic Protection**: Previously captured frames for the session remain safely stored on disk and recorded in SQLite.
- **Operator Action**: Reconnect the USB tether cable and power-cycle the camera if needed. Click **Capture Shot (Space)** to resume from the next missing frame without restarting the session or losing earlier shots.

### 4.2 Application Crash or Power Loss During Print Submission (Scenario A05)
- **Symptom**: Station restarts while a print job was in the `submitting` window.
- **Automatic Protection**: Startup reconciliation (`runStartupReconciliation()`) transitions interrupted `submitting` print attempts to **`unknown`** and **never** automatically reprints.
- **Operator Action**:
  1. Visually inspect the physical printer tray to see whether the print emerged.
  2. In the Operator Console alert banner (`Outcome unknown — inspect physical printer`), select **Mark Printed** (`confirmed`) if the guest received the print, or **Mark Failed** (`failed`) if nothing printed.
  3. If marked failed, press **Reprint Approved Composite (P)** to submit a new audited print attempt.

### 4.3 Low Disk Space Warning (Scenario A19)
- **Symptom**: Banner displays `Disk Space Insufficient: New captures blocked`.
- **Automatic Protection**: New session creation is blocked so pending approved sessions and queued uploads are never corrupted or overwritten.
- **Operator Action**: Free disk space on the station drive (outside the active `ODC_DATA_DIR/sessions` folder) or connect to the internet so published and expired sessions can complete their lifecycle.

### 4.4 Device Clock Jump Warning (Scenario A20)
- **Symptom**: Banner displays `Device clock jumped relative to monotonic clock`.
- **Automatic Protection**: Local capture, compositing, and local printing remain operational so guests at the event are not blocked, but background cloud publication pauses until the station reconciles its clock with the server.
- **Operator Action**: Reconnect the station to the network to trigger `reconcileClockWithServer()`, which restores healthy time synchronization and resumes queued uploads.

### 4.5 Authentication Expiry or Operator Revocation While Offline (Scenarios A08 & A09)
- **Symptom**: Sync drawer shows `blocked_auth`.
- **Operator Action**: Reauthenticate with an active operator or admin account assigned to the event, then trigger `resumeAuthBlockedJobs()`.

## 5. Customer Display (Wired Monitor and BYOD Tablet)

The customer display is **off by default**. Capture, approval, printing and sync never depend on it. If any display problem affects those flows, set the mode to `off` and treat it as a release blocker.

> [!WARNING]
> No physical hardware row is certified until its qualification record (`docs/customer-display-qualification-template.md`) is marked PASS. Until then every hardware combination is `UNVERIFIED`.

### 5.1 Wired monitor setup
1. Connect the monitor (HDMI, or native USB-C DisplayPort) and set Windows to **Extend these displays** (Win+P). Do not use Duplicate.
2. In the operator console open **Display settings**, press **Identify** to flash a number on each screen, then select the customer monitor.
3. Choose mode `wired`. A borderless kiosk window opens on that monitor. Selection uses a stable monitor fingerprint, never the volatile Electron display ID.
4. If two identical monitors are attached the status shows **ambiguous** and no window opens; unplug one or choose again after identifying.

### 5.2 BYOD tablet setup (offline)
1. Use a dedicated router with no internet requirement, isolated from venue/guest Wi-Fi. **Never use venue or public Wi-Fi.** The server binds only to a private IPv4 address (10.x, 172.16-31.x, 192.168.x).
2. Choose the station's private network interface in Display settings and set mode `tablet` (or `both`).
3. Scan the on-screen QR code with the tablet. The pairing link is single-use and short-lived; after pairing the QR is hidden. Only one tablet can be paired at a time.
4. iPad: open the page, **Share → Add to Home Screen**, launch it from the Home Screen icon, then enable **Guided Access** (Settings → Accessibility).
5. Android: open in Chrome, use **Add to Home screen**, and enable **screen pinning** (App pinning).
6. Reset pairing at any time from Display settings; the old tablet is disconnected immediately.

### 5.3 Firewall
The installer adds one inbound rule named `ODC-PhotoStudio BYOD Display (Private)` (installed executable, TCP `47940`, **Private profile only**) and removes it on uninstall; upgrades replace it. The application never changes firewall settings itself. If the installer was not elevated, the default port is changed, or you run a development build, add the rule manually from an elevated PowerShell:

```powershell
netsh advfirewall firewall add rule name="ODC-PhotoStudio BYOD Display (Private)" dir=in action=allow protocol=TCP localport=47940 profile=private program="<full path to the executable>"
netsh advfirewall firewall delete rule name="ODC-PhotoStudio BYOD Display (Private)"
```
For a non-default port substitute it for `47940` in the first command. Ensure the router network is classified as **Private** in Windows.

### 5.4 Disconnect recovery
- **Cable removed / monitor missing**: status shows `missing`. Capture continues. Reconnect the cable; the kiosk window reopens automatically.
- **Tablet sleeps or Wi-Fi drops**: status shows `reconnecting`; the tablet reconnects on its own. If it does not, reset pairing and re-scan the QR.
- **Camera failure**: the customer screen shows a "one moment" message; follow section 4.1. Captured shots are preserved.

### 5.5 Rollback
Set the display mode to `off`. The kiosk window and tablet server close, pairing is invalidated, preview images are cleared, and live view stops after a 5-second grace period. No cloud or schema rollback is needed.
