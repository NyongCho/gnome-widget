# README screenshots

`widgets-dark-en.png` and `widgets-light-en.png` are unedited screenshots of the public GJS edition running in a disposable GNOME Shell 50 session. The widget interface and sample city, event, and track names are English. Data is synthetic; no personal calendar, location, or media data is used.

The compact-layout fixture keeps Korean as its default. To regenerate the English screenshots from the repository root in a Wayland session:

```sh
./scripts/dev npm --prefix extension run build -- --edition gjs
LIQUID_SCREENSHOT_LANGUAGE=en LIQUID_GNOME_WORK=/tmp/liquid-widgets-readme-en \
  ./scripts/test-gnome.py --edition gjs --compact

cp /tmp/liquid-widgets-readme-en/screenshots/gjs/compact/compact-ready.png docs/images/widgets-dark-en.png
cp /tmp/liquid-widgets-readme-en/screenshots/gjs/compact/compact-ready-light.png docs/images/widgets-light-en.png
```

The fixture checks for Korean text before the English capture and runs the normal content-fit, theme, calendar alignment, scaling, and glass-cache checks. The images are taken directly through GNOME Shell's screenshot API. The private test session leaves the user's desktop language and preferences unchanged.
