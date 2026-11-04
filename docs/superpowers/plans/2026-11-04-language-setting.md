# Language Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users choose Korean or English for the widgets and preferences.
**Architecture:** A shared typed message catalog and locale mapping translate app-owned text. GSettings persists the choice; property bindings update the existing GTK controls while Shell rerenders existing cards.
**Tech Stack:** TypeScript, GJS/GSettings, GTK4/libadwaita, existing Node and private GNOME test harnesses.
**Spec:** `docs/superpowers/specs/2026-11-04-language-setting-design.md`

## Global Constraints

- `language` choices `ko`, `en`; default `ko`.
- Locale mapping `ko-KR`, `en-US`; keep system timezone, hour cycle and week start.
- Change displayed text immediately, preserving drafts, selections, subscriptions and private credentials.
- External event/media/place text remains unchanged; no new dependencies or daemon protocol changes.
- Keep the current local feature checkout and existing installation workflow; no logout, merge or push.

## Review Focus

- Language changes during pending operations must preserve drafts and finish in the current language (Task 2).
- Repeated switching must not add subscriptions, callbacks or stale widget bindings (Task 2).
- Empty, error, loading and cached states need both languages (Task 1).
- Clock ticks and provider updates must not revert the chosen language (Task 2).
- Persisted English must survive preference reopening and extension reactivation (Task 2).

### Task 1: Shared translated presentation

**Files:** Create `extension/src/shared/i18n.ts`, `extension/tests/i18n.test.ts`; modify `cardState.ts`, `calendarStatus.ts`, `agenda.ts`, `weatherFormat.ts`, `liveData.ts` in shared.
**Interfaces:** `Language = 'ko'|'en'`; `language(value:string):Language`; `localeFor(language):string`; `translate(language,message,values?):string`; `TextBindings` with `language`, `setLanguage`, `bind`, `unbind`, `destroy`. Existing presentation helpers take an optional final language argument defaulting to `ko`.

- [x] Write tests for English error/loading/cached/calendar status, all-day and weather/rate labels, invalid preference fallback, locale mapping, and property updates preserving unrelated input; verify the existing Korean-only helpers fail English expectations.
- [x] Implement the catalog, bounded property binding ownership and language-aware helpers. Values interpolate without reinterpreting user text.
- [x] Run `./scripts/dev npm --prefix extension test`; expect all tests pass.
- [x] Commit shared presentation changes.

### Task 2: Persisted selection and actual GNOME UI

**Files:** Modify schema, `extension/src/prefs/{pages,placement,calendar,weather}.ts`, add `extension/src/prefs/language.ts`; modify `extension/src/widgets/{host,card,weather,live}.ts`; modify `extension/tests/gnome/preferences.js`, `tests/gnome/{preferences,widgets}.js`; update user docs.
**Interfaces:** `TextBindings` drives property changes from `changed::language` until window destruction. WidgetHost reads the same key at layout/render; tick locale cannot override it.

- [x] Add failing real GTK selection/draft preservation tests and Shell language/tick/disable-enable persistence assertions. Run existing build then `./scripts/test-gnome.py --preferences`; expect missing language control failure.
- [x] Add enum schema key, first-page selector, GTK property translations and Shell translated text/date rendering. Dispose bindings for removed search rows and on window destruction.
- [x] Run typecheck/build and Node tests, then actual GTK and full GNOME tests. Expect both languages, retained drafts/status, translated delayed responses and no duplicate calendar subscriptions.
- [x] Inspect isolated Korean/English screenshots and run `./scripts/check.sh`; expect exit 0.
- [ ] Commit; perform one fresh whole-change review, resolve material findings, package/install, verify artifacts and existing calendar connection without exposing private data.
