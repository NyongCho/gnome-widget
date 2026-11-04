# Clock face prototypes — 2026-11-04

Four disposable native GNOME clock compositions answering the user's request to see applied examples before selecting a design. They follow the previous reference image order: oversized digital, square analog ticks, numbered circular analog, minimal analog.

Open [index.html](index.html) for a variant/theme switcher. `?variant=1&theme=dark` through `?variant=4&theme=light` select the eight applied screens; variant 0 is the comparison board. Left/right keys cycle. Files work offline.

These are captures of the actual St/Cairo foreground inside the project's actual GlassCard and shader material. The four applied scenes retain the real weather/calendar/agenda/system/network layout. All four clock cards measure 232×230 logical pixels. Time is fixed to 2026-11-04 10:08:38 Asia/Seoul; all other data and the abstract wallpaper are synthetic. No private desktop content or account data is used.

The original renderer is preserved on the `prototype/clock-faces` branch (commit `47bedba`). On that branch, reproduce in the isolated GNOME Devkit:

```sh
./scripts/test-gnome.py --clock-prototype
```

The user selected the large digital face as default and requested all four as options. The throwaway renderer was retired from the active branch; its source lives at `tests/gnome/clock-prototype.js` on `prototype/clock-faces`. These images remain historical static design comparisons. Production uses the typed `ClockFace` renderer with actual local time, localized dates, saved settings and owned timers. Run `./scripts/test-gnome.py --clock-styles` to exercise the production faces.
