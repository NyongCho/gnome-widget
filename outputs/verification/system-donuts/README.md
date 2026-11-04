# System donuts — 2026-11-04

CPU and RAM now use two monochrome, rounded donut gauges inspired by the user's macOS battery-widget reference. Each ring starts at noon and fills clockwise; percentages are centered and CPU/RAM labels sit below. The existing memory GiB and temperature details remain. No Rust data collection or sampling behavior changed.

[Before](before.png), [dark](system-prefer-dark.png), [light](system-prefer-light.png), [125% display](system-125.png), and [unknown values](system-unknown.png) are actual GNOME 50.1 captures with synthetic data in a private session.

`./scripts/test-gnome.py --system` failed before implementation because the actual system card had no donut gauges. Afterward, pixel sampling at the four quadrant midpoints verified CPU 25%, RAM 50%, zero usage, and a full ring at 100%. Null CPU and zero memory total retain empty tracks and em dashes. The test also verifies centered number labels, undistorted rings, Korean/English, light/dark, widget scale 1.5, display scale 125%, updates and card teardown. [Measurements](measurements.json) include the synthetic values and painted quadrants.

`./scripts/check.sh` passed: Rust 94, TypeScript 61, installer 7, plus formatting/clippy/type checking/build/GJS/IPC. `./scripts/test-gnome.py --compact` passed for all cards, including error/recovery, content-sized height, language/scale, narrow layout and glass-cache retention. Independent source review found no actionable issues. The system card's 221px height at default Korean scale is driven by the rings and visible details, with no reserved error footer.

The release package is installed. [Installation checks](installation.json) confirm all eight extension files and the daemon match, settings are preserved, and the user service is active/enabled. New Shell code loads after logout/login; the current user session was not restarted.
