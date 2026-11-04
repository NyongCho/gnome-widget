# Media artwork — 2026-11-04

The square `St.Icon` stretched a synthetic 160×90 image to 44×44. The real GNOME regression failed with an observed ratio of **1.000 instead of 1.778** before the UI change. The replacement asynchronously decodes local files at display size and paints aspect-preserving `St.ImageContent`; the card owns cancellation and stream cleanup.

The screenshots contain only synthetic imagery and track text. [Wide](art-wide-1.png), [square](art-square-1.png), [portrait](art-portrait-1.png), [125% display](art-wide-1.25.png), and [invalid-image fallback](art-invalid.png) were captured in a private GNOME 50.1 session. Pixel measurements, rather than actor dimensions alone, verify the displayed image:

| Image | 100% display | 125% display | Source ratio |
|---|---:|---:|---:|
| Wide | 78×44 / 1.773 | 77.6×44 / 1.764 | 1.778 |
| Square | 44×44 / 1.000 | 44×44 / 1.000 | 1.000 |
| Portrait | 25×44 / 0.568 | 24.8×44 / 0.564 | 0.563 |

Dimensions are logical pixels; fractional-edge rounding explains the small differences. The test also checks missing/corrupt files, preserved track text, rapid replacements and closing a card during loading. See [measurements](dimensions.json) and [red/green evidence](regression.json).

Spotify supplied an HTTPS artwork URL that the previous file-only collector discarded. Rust now fetches it into a private, atomic, bounded disk cache and continues to publish only local URIs to Shell. The real D-Bus collector regression failed before implementation and passed afterward; separate tests exercise actual HTTP responses, cache reuse, limits, failure handling and changes to track/player/owner/playback during a download.

A read-only live probe used the new production `Artwork` and `Http` code with the running Spotify player's artwork URL. It downloaded **120,793 bytes**, produced a readable local file, reused the same cache entry, and GdkPixbuf decoded a **640×640** image. The [probe result](live-probe.json) contains only those measurements. The URL, track metadata and album image were neither logged nor retained in this repository; the temporary cache was removed and playback was not changed.

Verification commands: `./scripts/check.sh`, `./scripts/test-gnome.py --media-art`, and `./scripts/test-gnome.py`. The latter covers layout, input routing, fractional scaling, service owner changes and 20 enable/disable cycles.

All passed. Final full checks include 94 Rust tests (excluding duplicate private-bus subprocess runs; 3 existing live probes ignored), 61 TypeScript tests, 7 installer tests, formatting/clippy/type checks, GJS smoke/IPC and build isolation. Independent review caught a successful download being discarded when the shared worker pool was busy. A new failing collector test reproduced it; media disk work now waits cancellably for the existing bounded pool, retaining bytes without another HTTP request. The regression and queued-cancellation test pass, and rereview found no remaining issues.

The release package was installed. [Installation verification](installation.json) confirms all eight extension files and the daemon match, settings are preserved, and the user service is active/enabled. The new Shell code loads after logout/login; the user's session was not restarted.
