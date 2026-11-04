# Media Artwork Repair Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for integration. Backend and UI are independent tasks dispatched through superpowers:dispatching-parallel-agents; preserve the shared MediaData contract.

**Goal:** Keep video thumbnails undistorted and display Spotify's supplied album cover.

**Architecture:** Rust resolves HTTPS MPRIS artwork to bounded private cached files; the IPC still exposes only local file URIs. GNOME asynchronously decodes the local image at display size and renders it at its original aspect ratio within a bounded media row, with a generic icon during loading/failure. Per-card image work is canceled on destruction. Existing playback selection remains unchanged.

**Tech Stack:** Rust/reqwest/zbus, TypeScript/GJS, Gio/GdkPixbuf/Clutter, existing GNOME 50 test runner.

**Spec:** User reports 16:9 YouTube thumbnails stretched into squares and absent Spotify artwork. Live metadata confirms Firefox supplies file artwork and Spotify supplies HTTPS artwork on i.scdn.co; the existing service discards HTTPS.

## Constraints and review focus

- Preserve original image proportions and all image content; video fits up to 78×44 logical px at UI scale 1, square album art stays 44×44.
- Keep title/artist visible when art is missing, invalid or slow.
- Shell performs no HTTP and image decoding/loading stays asynchronous.
- Reject late art for a previous track, closed card or replaced player.
- Bound download bytes, time and disk cache; reuse an unchanged URL and preserve existing local-file/FIFO checks.
- Verify 16:9, square, portrait, invalid art, replacement and fractional scaling with actual rendered pixels. Avoid logging listening metadata or private URLs.

## Task 1: Remote artwork collection (backend agent)

Files: `daemon/src/providers/media.rs`, a focused artwork-cache module, `providers/mod.rs`, `main.rs`, `daemon/tests/media.rs` and related backend tests/dependencies as needed.

Interface: `MediaData.art_uri` remains `Option<String>` containing a local file URI; existing `local_art` remains file-only. A persistent media service owns the cache and receives the existing XDG cache root and Fetcher/BlockingWorker.

- [x] Reproduce HTTPS art omission at the real collector seam before implementation.
- [x] Add bounded private atomic cache, asynchronous download, reuse/failure handling and event cancellation.
- [x] Verify Rust tests, format/clippy, actual D-Bus property/owner changes and controlled HTTP/cache behavior.

## Task 2: Aspect-preserving image display (parent)

Files: `extension/src/widgets/live.ts`, `extension/src/widgets/artwork.ts`, `tests/gnome/media-art.js`, `scripts/test-gnome.py`.

- [x] Reproduce stretched 16:9 artwork with a synthetic local PNG through the actual media card.
- [x] Replace square icon artwork with asynchronous scaled image content, fixed row height, intrinsic image width, fallback and cancellation on destroy.
- [x] Verify actual pixel proportions for wide/square/portrait images, scaling, failure and replacement; run full checks and functional GNOME regression.
- [x] Independently review, verify live Spotify artwork retrieval without exposing listening metadata, package/install with settings preserved, record evidence and commit.

**Result:** [Verification evidence](../../../outputs/verification/media-artwork/README.md). Review's worker-contention finding was reproduced and repaired by cancellably awaiting existing worker capacity for media disk operations. Other providers retain try-acquire scheduling. Final checks: 94 Rust tests, 61 TypeScript tests, 7 installer tests plus GJS/IPC and real GNOME media/functional suites. Installed files match; settings are preserved; new Shell code loads at next login.

References: [MPRIS artwork metadata](https://specifications.freedesktop.org/mpris/latest/Track_List_Interface.html), [GNOME 50.1 texture loading source](https://github.com/GNOME/gnome-shell/blob/50.1/src/st/st-texture-cache.c). The global TextureCache keeps per-file monitors, so this card owns its asynchronous stream/decode lifecycle for changing artwork URLs.
