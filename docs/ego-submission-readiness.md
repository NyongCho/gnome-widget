# GNOME Extensions submission readiness

Rules assessed: **2026-11-07**; release status updated: **2026-11-08**. Scope: official submission rules, the v0.1.0 release, and the verified bundle cleanup distributed as v0.1.1. This is not submission authorization.

**Conclusion:** the confirmed unused-code findings are resolved in [v0.1.1](https://github.com/NyongCho/gnome-widget/releases/tag/v0.1.1), with matching source, a rebuilt ZIP and passing checks for both editions and native GNOME installation. The published v0.1.0 ZIP remains unchanged. Maintainer readiness and reviewer acceptance remain unresolved.

## Existing evidence

[The release record](gnome-extensions-release.md) documents GPL-3.0-or-later, matching public source, readable GJS packaging, third-party notices, lifecycle testing and the worker justification. The [artifact record](../outputs/verification/release-v0.1.0/artifact.json) identifies SHA-256 `d8879fbbd06441f3df44f03f42ec1cfa4b252c5d33bb3829d9ec1b35c3ef6199`, 504,900 bytes, 12 passing packaging tests, and installation/enable/preferences/disable/uninstall on GNOME Shell 50. It explicitly records `gnomeExtensionsSubmitted: false`.

The accompanying artifact audit confirmed the released checksum, 17 ZIP entries and package-policy PASS. These establish the tested artifact; they do not establish acceptance by GNOME reviewers.

## Verified bundle cleanup

The build now selects the backend implementation before bundling. Ajv emits separate validator modules and shares its helpers, allowing unused validators to be omitted without changing schemas, validation options or parsing call sites. JavaScript remains formatted and unminified; the calendar engine, timezone data and all license notices are unchanged. This follows the [Ponytail skill](https://github.com/DietrichGebert/ponytail/blob/main/skills/ponytail/SKILL.md) approach of reusing installed tools and preserving validation.

| Artifact | v0.1.0 bytes | Cleaned bytes |
| --- | ---: | ---: |
| `extension.js` | 1,082,379 | 715,246 |
| `prefs.js` | 1,021,577 | 663,695 |
| `calendar-worker.js` | 887,235 | 94,383 |
| ZIP | 504,900 | 362,079 |
| Uncompressed package | 4,306,052 | 2,788,185 |

Only those three JavaScript entries changed. The ZIP is 28.3% smaller, and its uncompressed contents are 35.2% smaller. The [cleanup artifact record](../outputs/verification/public-bundle-cleanup/artifact.json) identifies SHA-256 `d3082451743a48906e6a3b9e3a47fc5769e314e99c877da2ae9922df5e4d5b43` and the retained verification logs.

`check.sh --edition all` passed: Rust checks and live IPC, 143 Node tests, 59 calendar cases per engine, nine native public suites and 26 Python tests. The emitted-build regression first failed for the retained Rust backend and then for unrelated worker validators; it now passes for both editions without build warnings. The exact ZIP installed, enabled, collected local data, opened production preferences, disabled and uninstalled in disposable GNOME Shell 50 without Rust. Two subsequent independent reviewers found no issues, including 6,480 comparisons of validator behavior and another full-suite/native installation run. The v0.1.1 release has the same entry contents; see its [artifact record](../outputs/verification/release-v0.1.1/artifact.json). No GNOME Extensions upload has been performed.

## Original findings and remaining review risks

- **Unused bundled code (resolved on the branch):** v0.1.0 contained unused Rust session/transport code in `extension.js`, an unreachable Rust preferences branch, and unrelated worker validators. The cleanup above removes these confirmed findings. Official rules require reviewable JavaScript and permit rejection for unreasonable unnecessary data; they publish no numeric bundle-size limit. [Review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html#code-must-not-be-obfuscated), [unnecessary files](https://gjs.guide/extensions/review-guidelines/review-guidelines.html#don-t-include-unnecessary-files).
- **GJS worker:** external scripts are strongly discouraged, not categorically banned. Unavoidable helpers must spawn carefully and exit cleanly; bundled binaries are prohibited; scripts normally use GJS and an OSI-approved license. The documented short-lived worker and cancellation evidence support a justification, whose sufficiency remains a review judgment. [Scripts and binaries](https://gjs.guide/extensions/review-guidelines/review-guidelines.html#scripts-and-binaries).
- **Maintainer explanation:** AI assistance is permitted, but the developer should explain and justify submitted code. Large unnecessary code, imaginary APIs, inconsistent style and prompt-like comments are rejection indicators. Test results cannot demonstrate the human maintainer's understanding. [AI rule](https://gjs.guide/extensions/review-guidelines/review-guidelines.html#extensions-must-not-be-ai-generated).

## Hard requirements versus recommendations

GPL-3.0-or-later is explicitly listed as compatible. Runtime cleanup, valid metadata, readable JavaScript and absence of bundled executables are requirements; the release record supplies relevant evidence rather than a reviewer decision. [Official requirements](https://gjs.guide/extensions/review-guidelines/review-guidelines.html).

A ZIP needs `extension.js` and `metadata.json`; submission also needs a valid project URL. The documented public UUID, Shell 50 target and public repository supply the corresponding identity/support information. [Extension anatomy](https://gjs.guide/extensions/overview/anatomy.html#extension-zip), [URL requirement](https://gjs.guide/extensions/overview/anatomy.html#url).

The release has integer **`metadata.version: 1`**. The review guidelines call this field deprecated. The anatomy documentation says developers **SHOULD NOT** set it and that the website overrides it. Thus omission is recommended for an EGO-specific artifact, but these sources do **not** establish a mandatory rejection for the existing integer. `version-name` is the separate optional user-visible version. [Review metadata](https://gjs.guide/extensions/review-guidelines/review-guidelines.html#metadata-json-must-be-well-formed), [version semantics](https://gjs.guide/extensions/overview/anatomy.html#version), [version-name](https://gjs.guide/extensions/overview/anatomy.html#version-name).

## Manual submission steps and limits

1. Confirm that the intended maintainer can support and explain the implementation. Extensions are supported by their authors. [GNOME Extensions about page](https://extensions.gnome.org/about/).
2. Sign in to a GNOME Extensions account, or register one. The current **Add yours** route redirects unauthenticated visitors to login. [Upload](https://extensions.gnome.org/upload/), [registration](https://extensions.gnome.org/accounts/register/).
3. Select the public ZIP from v0.1.1 and complete the authenticated upload form with accurate listing information. Include the worker rationale and matching source link wherever review notes are accepted. This assessment did not access that form and does not assert an icon or screenshot is mandatory.
4. Respond to review feedback and wait for approval before calling the extension available on GNOME Extensions. Uploaded extensions undergo review before download availability. [Review process](https://extensions.gnome.org/about/).

No GNOME Extensions account action, upload or listing change was performed. Actual Google-account integration, external weather requests and physical login/lock behavior remain outside the synthetic public-release evidence. The five-pair desktop performance benchmark was not repeated for this build cleanup. GNOME's update check returned Not Found for the unpublished extension during the successful isolated installation test.
