# Compact Cards Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this bounded change; implement and verify in the existing feature branch.

**Goal:** Enlarge card headings and remove unused space below ordinary content while retaining readable error messages.

**Architecture:** Keep the existing two-column/scrolling layout. Measure each card's real St content at its available width after rendering; pass those heights to the pure layout function. Hide empty status labels and reflow after content, theme, scale or connection-state changes. Keep shader settings unchanged.

**Tech Stack:** TypeScript, GNOME 50 St/Clutter, CSS, existing GNOME Devkit runner.

**Spec:** User requests in this thread: other headings should read as prominently as the weather location; reduce the empty lower area apparently reserved for errors. Implementation choice: common heading size 15px at scale 1 (previously 13px), content-sized cards and conditional status row.

## Constraints and review focus

- Preserve foreground/background alignment, settings, calendar credentials and private data.
- Six-week months, three agenda items and full weather details must fit.
- A stale/error message must expand its card and disappear on recovery.
- Scaling, narrow one-column layouts and language changes must remeasure without clipping or double scaling.
- Repeated data/clock updates of unchanged height must retain the cached glass input.
- Keyboard scrolling must still reach the final card.

## Task 1: Content-sized cards and readable headings

Files: `extension/src/shared/layout.ts`, `extension/src/widgets/card.ts`, `extension/src/widgets/host.ts`, `extension/stylesheet.css`, `extension/tests/layout.test.ts`, `tests/gnome/compact.js`, `tests/gnome/widgets.js`, `scripts/test-gnome.py`.

Interface: `computeLayout(config, area, visible, measuredHeights = {})`, with measured heights in already-scaled logical screen pixels. Omitted/invalid measurements retain the existing defaults. Card content remains the measurement owner; the host applies geometry after rendering and measuring.

- [x] Add pure layout tests for measured row packing and scale handling, and a GNOME regression for collapsed status/compact bottom padding and error/recovery resizing. Observe failures before implementation.
- [x] Hide empty status labels, stop vertical body expansion, enlarge common titles to 15px, and reflow from measured content after updates.
- [x] Run the full check suite and actual GNOME compact, visual and functional checks. Inspect screenshots with synthetic data, including Korean/English and fractional scaling.
- [x] Independent review, package/install verification with settings preserved, document results and commit.
