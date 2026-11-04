# Calendar today alignment — 2026-11-04

[Before](before.png) / [after](after.png), cropped from the same synthetic-data calendar in a private GNOME 50.1 test session. No personal calendar data is included.

The fixed-height day label drew the numeral above the center of its highlighted background. The original Pango ink-center check failed at -4 logical px. The fixed cell now owns the highlight; an intrinsic-size label is centered inside it, with a small font-relative optical correction. The event dot has explicit vertical expansion so BinLayout honors bottom alignment and keeps it below the numeral.

The regression checks both Pango geometry and actual screenshot pixels. It temporarily hides the event dot without changing layout when measuring numeral pixels. Pango ink extents are divided by Clutter resource scale; layout offsets are already logical pixels. Actual pixel checks also caught a horizontal shift in an intermediate stretched-label version, which is why the final label retains its natural width.

Final [pixel measurements](alignment.json) cover dark/light mode, Korean/English at UI scale 1.5 and display scaling 125%. Absolute horizontal/vertical ink-center offsets were at most 1 logical px. `./scripts/test-gnome.py --compact`, `--visual` and the full `./scripts/check.sh` suite passed. Independent review found no actionable issues.

The installed extension's eight files match the package, settings are preserved and the service remains active/enabled. New code loads after logout/login.
