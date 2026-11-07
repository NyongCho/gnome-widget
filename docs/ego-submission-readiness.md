# GNOME Extensions submission readiness

Assessed: **2026-11-07**. Scope: current official submission rules and the existing v0.1.0 release evidence; this is not submission authorization or a new functionality test.

**Conclusion:** submission is feasible, but trim confirmed unused bundled code before recommending the current ZIP for review. The release is a working submission candidate, not an approved GNOME Extensions listing. Maintainer readiness and reviewer acceptance remain unresolved.

## Existing evidence

[The release record](gnome-extensions-release.md) documents GPL-3.0-or-later, matching public source, readable GJS packaging, third-party notices, lifecycle testing and the worker justification. The [artifact record](../outputs/verification/release-v0.1.0/artifact.json) identifies SHA-256 `d8879fbbd06441f3df44f03f42ec1cfa4b252c5d33bb3829d9ec1b35c3ef6199`, 504,900 bytes, 12 passing packaging tests, and installation/enable/preferences/disable/uninstall on GNOME Shell 50. It explicitly records `gnomeExtensionsSubmitted: false`.

The accompanying artifact audit confirmed the released checksum, 17 ZIP entries and package-policy PASS. These establish the tested artifact; they do not establish acceptance by GNOME reviewers.

## Confirmed cleanup and review risks

- **Unused bundled code:** the artifact audit found `RustWidgetSession`, `SessionTransport` and `DataClient` behind an unconditional public-backend branch in generated `extension.js` (19,971 lines; 1,082,379 bytes), and an unreachable Rust preferences branch in `prefs.js` (18,574 lines; 1,021,577 bytes). The calendar worker also carries unrelated validators. This is retained JavaScript, not a bundled Rust executable. Remove avoidable branches and validators before submission; the audit does not establish how much of each bundle can be removed. Official rules require reviewable JavaScript and permit rejection for unreasonable unnecessary data. They publish no numeric bundle-size limit. [Review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html#code-must-not-be-obfuscated), [unnecessary files](https://gjs.guide/extensions/review-guidelines/review-guidelines.html#don-t-include-unnecessary-files).
- **GJS worker:** external scripts are strongly discouraged, not categorically banned. Unavoidable helpers must spawn carefully and exit cleanly; bundled binaries are prohibited; scripts normally use GJS and an OSI-approved license. The documented short-lived worker and cancellation evidence support a justification, whose sufficiency remains a review judgment. [Scripts and binaries](https://gjs.guide/extensions/review-guidelines/review-guidelines.html#scripts-and-binaries).
- **Maintainer explanation:** AI assistance is permitted, but the developer should explain and justify submitted code. Large unnecessary code, imaginary APIs, inconsistent style and prompt-like comments are rejection indicators. Test results cannot demonstrate the human maintainer's understanding. [AI rule](https://gjs.guide/extensions/review-guidelines/review-guidelines.html#extensions-must-not-be-ai-generated).

## Hard requirements versus recommendations

GPL-3.0-or-later is explicitly listed as compatible. Runtime cleanup, valid metadata, readable JavaScript and absence of bundled executables are requirements; the release record supplies relevant evidence rather than a reviewer decision. [Official requirements](https://gjs.guide/extensions/review-guidelines/review-guidelines.html).

A ZIP needs `extension.js` and `metadata.json`; submission also needs a valid project URL. The documented public UUID, Shell 50 target and public repository supply the corresponding identity/support information. [Extension anatomy](https://gjs.guide/extensions/overview/anatomy.html#extension-zip), [URL requirement](https://gjs.guide/extensions/overview/anatomy.html#url).

The release has integer **`metadata.version: 1`**. The review guidelines call this field deprecated. The anatomy documentation says developers **SHOULD NOT** set it and that the website overrides it. Thus omission is recommended for an EGO-specific artifact, but these sources do **not** establish a mandatory rejection for the existing integer. `version-name` is the separate optional user-visible version. [Review metadata](https://gjs.guide/extensions/review-guidelines/review-guidelines.html#metadata-json-must-be-well-formed), [version semantics](https://gjs.guide/extensions/overview/anatomy.html#version), [version-name](https://gjs.guide/extensions/overview/anatomy.html#version-name).

## Manual submission steps and limits

1. Confirm that the intended maintainer can support and explain the implementation. Extensions are supported by their authors. [GNOME Extensions about page](https://extensions.gnome.org/about/).
2. Sign in to a GNOME Extensions account, or register one. The current **Add yours** route redirects unauthenticated visitors to login. [Upload](https://extensions.gnome.org/upload/), [registration](https://extensions.gnome.org/accounts/register/).
3. After cleanup and verification, select the public ZIP and complete the authenticated upload form with accurate listing information. Include the worker rationale and source link wherever review notes are accepted. This assessment did not access that form and does not assert an icon or screenshot is mandatory.
4. Respond to review feedback and wait for approval before calling the extension available on GNOME Extensions. Uploaded extensions undergo review before download availability. [Review process](https://extensions.gnome.org/about/).

No account action, upload, listing change or code change was performed. Actual Google-account integration, external weather requests and physical login/lock behavior remain outside the synthetic public-release evidence, as already disclosed in the release record.
