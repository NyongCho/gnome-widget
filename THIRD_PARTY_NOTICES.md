# Third-party notices

Original project code is licensed under GPL-3.0-or-later; see the complete grant and license in `LICENSE`. The third-party materials below retain their own licenses and notices. The public ZIP includes `LICENSE` and the bundled dependencies' notices.

## ical.js 2.2.1

- Upstream: https://github.com/kewisch/ical.js
- Pinned commit: `277d52c8db379f133a88957793e03997a65307f4`.
- License: Mozilla Public License 2.0; the complete text is in `extension/vendor/ical/LICENSE` and the public ZIP's `licenses/ical-MPL-2.0.txt`.
- Covered source and original file notices are retained in `extension/vendor/ical/`. The modified source is distributed in this repository, including `budget.js` and the exact `budget.patch`. `manifest.json` records each source file hash.
- Modifications insert a deadline callback inside parser/recurrence loops. Application normalization and timezone selection are outside the vendored library. The worker's readable engine bundle is derived from these sources.
- Before distributing a binary/transpiled release, publish its matching source commit at https://github.com/NyongCho/gnome-widget and retain the covered files under MPL-2.0. A local unpushed source tree is not a public source download.

## Timezone data

IANA tzdb `2026e`, from https://data.iana.org/time-zones/releases/tzdata2026e.tar.gz. Source archive SHA-256: `b26882805f26aac59d5b222978e6580484b834ccdc98be89df2f05a6dc53a652`.

The data is public domain; see `extension/vendor/timezones/LICENSE` and ZIP `licenses/timezones.txt`. The generated 597 zone and alias definitions are bundled only into the calendar engine. They are not downloaded at runtime. `extension/vendor/timezones/manifest.json` records the output checksum and generator options; its README documents regeneration.

The build-only generator is libical/vzic, commit `42f509c9a613874a04af0d35be166c703a77389f`, under GPL-2.0-or-later. It is not included or executed in the public runtime.

## JSON validators

Generated validation functions contain code from Ajv 8.20.0 and ajv-formats 3.0.1:

- https://github.com/ajv-validator/ajv — MIT, Copyright (c) 2015–2021 Evgeny Poberezkin.
- https://github.com/ajv-validator/ajv-formats — MIT, Copyright (c) 2020 Evgeny Poberezkin.

Complete permission notices are copied into ZIP `licenses/ajv-MIT.txt` and `licenses/ajv-formats-MIT.txt`. The schema compiler, npm, Node.js and development typings are build tools, not runtime dependencies. Other build dependency licenses remain with their installed packages.

## External services and desktop libraries

Weather is obtained from Open-Meteo; its data attribution is shown in the UI. Location search uses the Open-Meteo geocoding service and GeoNames data. See https://open-meteo.com/en/terms and https://open-meteo.com/en/docs/geocoding-api. These services are not bundled source code.

GNOME/GJS, GLib/GIO, Soup, Secret Service and graphics libraries are provided by the desktop. No copies of their libraries are in the public ZIP. The personal Rust distribution remains separate and includes dependency license metadata generated from its Cargo lockfile.
