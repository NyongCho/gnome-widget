# Pinned timezone facts

`zones.json` contains complete VTIMEZONE definitions for tzdb 2026e's regional,
backward and etcetera source names, including aliases. It is loaded only by the
calendar calculation worker. No timezone download or native conversion occurs
at runtime. The input archive, converter commit, options and output SHA-256 are
recorded in `manifest.json`; IANA's license is in `LICENSE`.

This follows the generator used by ical.js 2.2.1's
[timezone workflow](https://github.com/kewisch/ical.js/blob/277d52c8db379f133a88957793e03997a65307f4/.github/workflows/ci.yml).
We additionally select `--pure` to preserve exact rules and include all aliases.

To regenerate, download the manifest's IANA archive and extract it, check out
the pinned libical/vzic commit, and build vzic with a C compiler and GLib headers:

```sh
make -C /path/to/vzic TZID_PREFIX= CREATE_SYMLINK=0 IGNORE_TOP_LEVEL_LINK=0
/path/to/vzic/vzic --pure --olson-dir /path/to/tzdb --output-dir /path/to/tzdb/zoneinfo
python3 extension/scripts/vendor-timezones.py /path/to/tzdb /path/to/tzdata2026e.tar.gz
```

The canonicalizer validates the input archive and complete name inventory and
removes generator wall-clock metadata. Its output is deterministic. The
GPL-licensed converter is a build tool; it is neither copied nor executed by
the public extension.
