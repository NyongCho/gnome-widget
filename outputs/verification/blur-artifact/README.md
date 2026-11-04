# Blur sampling regression — 2026-11-04

The reported checker-like lines were repeated copies of wallpaper detail caused by the blur's sparse sampling. The old shader stretched five Gaussian sample positions by four logical pixels, leaving gaps between samples. In a private GNOME 50.1 / NVIDIA RTX 3080 session, a single thin wallpaper stripe became multiple stripes. The same repetition was visible on the user's Tahoe wallpaper photograph.

- [Before: one stripe](before-stripe.png) / [after](after-stripe.png)
- [Before: photograph](before-photo.png) / [after](after-photo.png)
- [Before pixel profiles](before-profiles.json) / [after](after-profiles.json)

The baseline is the installed bundle from `fd0b325`. The fixed renderer samples every input texel using a normalized Gaussian, with sigma 6 logical pixels and separate texel sizes for the full-resolution horizontal input and half-resolution vertical input. Pairing adjacent taps was deliberately avoided: the downsampled output can fall between input texel centers and produce a central trough with paired offsets.

`./scripts/test-gnome.py --blur` exercises the real production shader through wallpaper rendering and screenshots. It checks horizontal/vertical profiles at 100%/125% display scaling: no secondary peak above 2 brightness levels, nonzero contrast and sufficient blur spread. The baseline failed all four cases with secondary peaks 30–36; the fix produced 0 in all four, with contrast 23. Replacing the test bundle with the installed baseline reproduced the failure a second time.

Photograph captures use the wallpaper image alone, cropped/repositioned identically before and after in the private test session, with foreground labels hidden. They are not captures of the user's calendar or desktop windows. Optional local photo comparison: `LIQUID_TEST_WALLPAPER=/absolute/path/image.png ./scripts/test-gnome.py --blur`.

The full `./scripts/check.sh` suite and GNOME `--visual` passed. The latter covers light/dark contrast, cache reuse and release, wallpaper refresh, edge-only refraction, and fractional scaling. Independent code review found no actionable issues. See [verification record](../../../docs/verification.md) for performance and installation results.

[Performance samples](performance.json): three OFF/ON pairs, paint p95 increases 0.600/0.608/0.473ms; ON p95 1.337/1.390/1.271ms. Owned textures remain 3,547,512 bytes. These are steady-state cached measurements, not first-generation blur latency or a long soak.

The updated package is installed and its eight extension files were compared byte-for-byte. Settings were preserved, the service is active/enabled, and the new extension code loads after logout/login.
