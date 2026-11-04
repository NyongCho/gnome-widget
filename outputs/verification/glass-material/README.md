# Glass material revision

2026-11-04, GNOME 50.1 / NVIDIA RTX 3080. These are screenshots of the actual extension in a private GNOME Devkit session, using synthetic wallpaper and fixture data. No personal calendar data is included.

- [Dark, reference-like gradient](widgets-dark-reference.png) / [light](widgets-light-reference.png): retained wallpaper color, thin directional edge and crisp text.
- [Dark, detailed wallpaper](widgets-dark-wallpaper.png) / [light](widgets-light-wallpaper.png): compare with the [previous dark material](../appearance/widgets-dark-wallpaper.png).
- [125% display scaling](widgets-dark-125.png): viewport scrolls when necessary; this capture also retains the narrow-clock test's 12-hour content.
- [White wallpaper, light](widgets-light-bright.png) / [dark](widgets-dark-bright.png): actual backdrop contrast, not CSS-only estimates.
- [Low-power light](widgets-light-low-power.png) / [dark](widgets-dark-low-power.png): readable fallback with no retained glass targets.
- [Refraction off](material-refraction-off.png) / [on](material-refraction-on.png): 652 changed edge pixels and no changed central pixels in the sampled clock material; foreground remains separate.
- [Contrast samples](contrast.json): light/default, explicit light and dark; black/white wallpaper; minimum/default tint. Lowest observed ratio 4.7667:1.
- [60-cycle lifecycle samples](lifecycle-memory.json): one root, six cards, 3,547,512 bytes of owned RGBA textures at every sampled checkpoint. This accounting is not total GPU process memory.
- [Performance samples](performance.json): three OFF/ON pairs, paint p95 increase 0.643/0.850/0.759ms. Measured the renderer at `2623ee6`, before the final light-palette constant adjustment; no 30-minute soak was performed for this revision.

Reproduce with `./scripts/test-gnome.py --visual`, `./scripts/test-gnome.py --lifecycle`, and `./scripts/test-gnome.py --benchmark`. See [verification notes](../../../docs/verification.md) for the test boundaries and installation record.
