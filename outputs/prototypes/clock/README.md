# Clock face prototypes — 2026-11-04

Four disposable native GNOME clock compositions answering the user's request to see applied examples before selecting a design. They follow the previous reference image order: oversized digital, square analog ticks, numbered circular analog, minimal analog.

Open [index.html](index.html) for a variant/theme switcher. `?variant=1&theme=dark` through `?variant=4&theme=light` select the eight applied screens; variant 0 is the comparison board. Left/right keys cycle. Files work offline.

These are captures of the actual St/Cairo foreground inside the project's actual GlassCard and shader material. The four applied scenes retain the real weather/calendar/agenda/system/network layout. All four clock cards measure 232×230 logical pixels. Time is fixed to 2026-11-04 10:08:38 Asia/Seoul; all other data and the abstract wallpaper are synthetic. No private desktop content or account data is used.

Reproduce in the existing isolated GNOME Devkit:

```sh
./scripts/test-gnome.py --clock-prototype
```

The throwaway renderer lives in `tests/gnome/clock-prototype.js`, only loaded by this explicit flag. It changes only the private session's presentation and settings. This is a static design comparison, not production support for selectable clock faces. No design has been selected or installed. The earlier left-alignment edit remains uninstalled pending that choice. Production implementation, live tick behavior, localization and scale acceptance follow selection; prototype code should be retired or preserved on a prototype branch at that point.
