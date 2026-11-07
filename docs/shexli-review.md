# Shexli submission warnings

Assessed 2026-11-08 against the owner's version-1 submission screenshots and the identical GitHub v0.1.1 ZIP. Shexli 0.2.1 reproduces all five warning categories. Two corrections are made after v0.1.1; this document does not represent GNOME reviewer approval or an uploaded replacement.

## Corrections

- **EGO-P-006:** exclude `schemas/gschemas.compiled` from the public ZIP and reject it in final artifact validation. Keep the schema XML and the development build's compiled cache. GNOME has compiled extension schemas automatically when installed through its extension tools since GNOME 44; this package targets 50. [Official GSettings documentation](https://gjs.guide/extensions/development/preferences.html#gsettings).
- **EGO-L-003, glass effect:** store the `failed` signal connection and disconnect it before destroying `GlassSurface`. The effect is a `Clutter.Effect`, not an actor. Removing it and releasing its textures did not disconnect the callback. A native regression retains the effect and emits `failed` after disable; v0.1.1 incorrectly schedules a new fallback idle, while the corrected build does not.

The packaging regressions first failed because the ZIP contained the compiled schema and the policy accepted it. They now pass, while the local compiled cache is preserved. The exact corrected ZIP installs, opens preferences and uses GSettings successfully without shipping a compiled schema.

## Remaining warnings and ownership evidence

The corrected artifact still produces **four warning categories**. They are not suppressed, and no extra imports or duplicate destruction calls are added to silence the analyzer.

| Rule | Explanation and code to inspect |
| --- | --- |
| EGO-P-007 | `calendar-worker.js` is an executable entry point launched with `Gio.Subprocess` in [`workerClient.ts`](../extension/src/calendar/workerClient.ts). Its two generated dependency chunks are reachable from that entry point. They must remain outside Shell/preferences imports to prevent calendar computation from blocking the UI. The package validator follows all three entry points and rejects unused JS. [Worker rationale and lifecycle evidence](gnome-extensions-release.md#reviewer-explanation-why-a-short-lived-worker). |
| EGO-L-002 | [`GlassCard`](../extension/src/widgets/card.ts) parents its button under `surface.actor`. Card destruction calls `surface.destroy()`, whose actor destruction recursively destroys the button and descendants. `WidgetHost.destroy()` visits all cards. [Clutter actor destruction](https://mutter.gnome.org/clutter/method.Actor.destroy.html). |
| EGO-L-005 | `WidgetHost.destroy()` clears its card map, and [`extension.disable()`](../extension/src/extension.ts) clears `host` after destroying it. The button reference is inside a card owned through that cleared graph, rather than an extension field surviving disable. The native test deliberately retains wrappers and verifies actor destruction independently of garbage collection; it does not claim to measure JS heap collection. |
| EGO-L-003 | The seven remaining connections belong to destroyed actors: card button/status, clock mode/drawing area/root, and toolbar settings button. Their native object disposal disconnects their signals. The clock root's `destroy` callback removes its second timer. Connections to longer-lived settings/adjustments are explicitly disconnected in [`WidgetHost.destroy()`](../extension/src/widgets/host.ts). The non-actor glass-effect callback is now explicitly disconnected. |

The native package regression observes **28 owned actors** receiving `destroy`, checks the card map and extension host reference are cleared, verifies the analog-clock GLib source is gone, and verifies every retained glass effect cannot schedule a callback after disable. It also checks public session/worker ownership, opens and closes production preferences, and uninstalls the extension in a disposable GNOME 50 session. See [`tests/gnome/package.js`](../tests/gnome/package.js) and the [recorded evidence](../outputs/verification/shexli-review/).

`check.sh --edition all` passed with Rust checks, 143 Node tests, 59 calendar cases per engine, nine native public suites and 27 Python tests (including 13 public packaging tests). Compared with the released v0.1.1 ZIP, only `extension.js` changes and `schemas/gschemas.compiled` is removed. The corrected ZIP has 16 entries; its SHA-256 and precise size are recorded in [artifact.json](../outputs/verification/shexli-review/artifact.json). The published v0.1.1 assets are unchanged.

## Reproduce

Use a separate development environment; these Python tools are not installed or bundled for extension users. Pinning tree-sitter avoids a segmentation fault observed with 0.26.0 on this machine.

```sh
uv venv /tmp/liquid-widgets-shexli --python python3.12
uv pip install --python /tmp/liquid-widgets-shexli/bin/python \
  'shexli==0.2.1' 'tree-sitter==0.25.2' 'tree-sitter-javascript==0.25.0'
python3 scripts/package.py --edition gjs
/tmp/liquid-widgets-shexli/bin/shexli --format json \
  dist/liquid-widgets-public/liquid-widgets.shell-extension.zip
LIQUID_GNOME_WORK=/tmp/liquid-widgets-shexli-native ./scripts/test-gnome.py --edition gjs \
  --package-zip dist/liquid-widgets-public/liquid-widgets.shell-extension.zip
```

Shexli's exit status alone does not indicate a warning-free package; inspect `summary` and `findings` in its JSON output. Remaining warnings require human review of the described entry points and ownership paths. These checks do not exercise private Google data, external weather services, or physical login/lock transitions, and the long performance benchmark was not repeated for these fixes.
