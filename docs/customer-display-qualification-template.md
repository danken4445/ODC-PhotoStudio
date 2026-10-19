# Customer Display Qualification Record

Copy this file per station build and fill it in. **Every hardware row defaults to `UNVERIFIED`.** Mark a row `PASS` only with attached evidence. If any selected release-support row is not `PASS`, keep display mode `off` and do not pilot.

## Build and station

| Field | Value |
| --- | --- |
| Station build / version | |
| Windows version | |
| DSLR / camera provider | |
| Operator initials | |
| Date | |
| Evidence links | |

## Wired monitor

| Field | Value |
| --- | --- |
| Monitor model | |
| Connection (HDMI / native USB-C DP) | |
| Orientation / aspect ratio | |
| Measured live-frame age (ms) | |
| Measured fps | |
| Dropped frame count | |
| Countdown 3-2-1 observed correctly | UNVERIFIED |
| Sleep / wake result | UNVERIFIED |
| Cable removed during idle | UNVERIFIED |
| Cable removed during countdown | UNVERIFIED |
| Cable removed during preview | UNVERIFIED |
| Cable removed during review | UNVERIFIED |
| WAN disconnected, still works | UNVERIFIED |
| Overall | UNVERIFIED |

## BYOD tablet (repeat per device)

| Field | Value |
| --- | --- |
| Tablet model | |
| OS version (current / oldest supported) | |
| Browser | |
| Router / topology (isolated, no internet) | |
| Private-profile firewall rule verified (install / upgrade / uninstall) | UNVERIFIED |
| Orientation / aspect ratio | |
| Measured live-frame age (ms) | |
| Measured fps | |
| Dropped frame count | |
| Countdown observed correctly | UNVERIFIED |
| Tablet sleep / wake and reconnect | UNVERIFIED |
| Wi-Fi interruption and reconnect | UNVERIFIED |
| Disconnect during idle / countdown / preview / review | UNVERIFIED |
| WAN disconnected, still works | UNVERIFIED |
| Pairing reset invalidates old tablet | UNVERIFIED |
| Overall | UNVERIFIED |

Required runs before any pilot: mock camera plus wired HDMI, native USB-C DisplayPort, current and oldest-supported iPadOS Safari, current and oldest-supported Android Chrome, WAN disconnected, sleep/wake, Wi-Fi interruption.

## Recovery if a row fails
Set display mode `off` (see runbook section 5.5). Do not add an operator workaround for a display failure that affects capture, approval, print, upload, or the next session; it blocks release.
