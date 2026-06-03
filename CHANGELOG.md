# Changelog

All notable changes to Claude Usage Monitor will be documented in this file.

## [1.1.0](https://github.com/voyagi/claude-usage/compare/v1.0.0...v1.1.0) (2026-06-03)


### Features

* **dashboard:** add per-message usage impact drill-down in Trends tab ([22bcc4f](https://github.com/voyagi/claude-usage/commit/22bcc4faf5e02d828033df5341ac1eb3f7d9483d))
* **dashboard:** per-message usage impact drill-down ([7cec85d](https://github.com/voyagi/claude-usage/commit/7cec85d06a20c55993c44fe0d5b4de35c95acd07))
* drift-canary — surface transcript schema-failures as a confidence signal ([#37](https://github.com/voyagi/claude-usage/issues/37)) ([7361775](https://github.com/voyagi/claude-usage/commit/73617755281a5900ed9754243709cd29c8bab747))


### Bug Fixes

* **api:** handle 429 rate limiting as expected behavior ([#19](https://github.com/voyagi/claude-usage/issues/19)) ([cbbaa35](https://github.com/voyagi/claude-usage/commit/cbbaa35ca959c973b177a5a3fd736439027b08ec))
* **api:** notify UI on 429 so rate-limited flag stays set ([7a2037c](https://github.com/voyagi/claude-usage/commit/7a2037c97e1793043285d0510fc68afba77634c7))
* correct usage counting (pricing table + message.id dedup) ([#28](https://github.com/voyagi/claude-usage/issues/28)) ([24dfdfc](https://github.com/voyagi/claude-usage/commit/24dfdfcd8b1f310a9bbc0069ee827e5c63d77f19))
* **deps:** patch tmp high advisory (GHSA-ph9p-34f9-6g65) ([#27](https://github.com/voyagi/claude-usage/issues/27)) ([f269558](https://github.com/voyagi/claude-usage/commit/f26955845723fa9186cddace16cb57151de257bf))
* harden incremental dedupe guard (memory, messageCount, keep-largest) ([#38](https://github.com/voyagi/claude-usage/issues/38)) ([d5ced74](https://github.com/voyagi/claude-usage/commit/d5ced740b87034d53eb497ac88d7f4989f41bc56))
* **parser:** dedupe by largest usage per message id, not last ([#36](https://github.com/voyagi/claude-usage/issues/36)) ([c063813](https://github.com/voyagi/claude-usage/commit/c063813cc27aae3649613b92f266626dc96ccee7))
* remove unused import and update biome schema version [skip-review] ([255bd17](https://github.com/voyagi/claude-usage/commit/255bd17567de25ac468479f8a311685663479e6d))
* resolve repo health issues (security, lint, circuit breaker) [skip-review] ([#24](https://github.com/voyagi/claude-usage/issues/24)) ([e29d2e6](https://github.com/voyagi/claude-usage/commit/e29d2e69250530c183bea5fdfdebf1c6b4c0b376))
* **security:** patch dependency advisories + guard token-forecast math ([#26](https://github.com/voyagi/claude-usage/issues/26)) ([4cc4400](https://github.com/voyagi/claude-usage/commit/4cc440086241430ea6dde0dfbf319328fdc81632))
* **test:** fix pre-existing flaky tests ([50bd9ee](https://github.com/voyagi/claude-usage/commit/50bd9eed2c1bfd0ebb8d183895fb7b07ae04d1d0))

## 1.0.0 (2026-03-23)


### Features

* **01-01:** create domain types, Zod schemas, and utilities ([11a8566](https://github.com/voyagi/claude-usage/commit/11a8566dcb5a6ce7da083d49be1330727f7b0b56))
* **01-02:** create streaming JSONL parser with error recovery ([1fcc4c2](https://github.com/voyagi/claude-usage/commit/1fcc4c2288e6c144e084aef81fdbcb7ac3cec010))
* **01-02:** create token extraction and billable token calculation ([bfdc571](https://github.com/voyagi/claude-usage/commit/bfdc571e41f7142097528421405eab1012eddb17))
* **01-03:** implement time bucket aggregation ([f63e8a4](https://github.com/voyagi/claude-usage/commit/f63e8a41dda1bcd94f0396c5759cff4b3a016c4d))
* **01-04:** create UsageStore with globalState persistence ([aab03d8](https://github.com/voyagi/claude-usage/commit/aab03d8db353e42be0201fca38758ebbf9f8d858))
* **01-04:** wire extension entry point with full data pipeline ([18f63f7](https://github.com/voyagi/claude-usage/commit/18f63f764818007955d7e37915ea7043f41854bc))
* **02-01:** create incremental JSONL parser with offset support ([f38840f](https://github.com/voyagi/claude-usage/commit/f38840f5b251645ac7fb603412136be6951545dd))
* **02-01:** create OffsetTracker for per-file byte offset persistence ([eac56e2](https://github.com/voyagi/claude-usage/commit/eac56e2e65c953c9e6b7733b9a59b5cd4b911f39))
* **02-02:** create SessionWatcher with debounced incremental parsing ([9913747](https://github.com/voyagi/claude-usage/commit/9913747e6c285d30d7ee130f2c9abc4441fc04dc))
* **02-02:** wire SessionWatcher into extension lifecycle ([5189ec4](https://github.com/voyagi/claude-usage/commit/5189ec43648ce41b52c5243ed2acaae934ff58d1))
* **03-01:** add rate limit types and plan token limits ([060d4e5](https://github.com/voyagi/claude-usage/commit/060d4e515040354905e89d5df5c0dae7e5d14237))
* **03-01:** create display formatting utilities ([40d7122](https://github.com/voyagi/claude-usage/commit/40d71225e951501b8e5bf1e3b44c12ac052ab3b1))
* **03-01:** create rate limit calculation engine ([3f7d7b1](https://github.com/voyagi/claude-usage/commit/3f7d7b17fb1995e12f0efc51b83955fa911ea101))
* **03-02:** create quick pick menu for usage actions ([3546015](https://github.com/voyagi/claude-usage/commit/354601591d02053e075c660e8eb9350f62419d63))
* **03-02:** create StatusBarManager with dual status items ([1362844](https://github.com/voyagi/claude-usage/commit/136284429a210a07d2a8d61f6962a9c42a127df1))
* **03-03:** add commands and compactMode setting ([f4994e5](https://github.com/voyagi/claude-usage/commit/f4994e52da077feee633cd7157df686e50e4213f))
* **04-01:** implement burn rate calculator and tier detection ([9a1db57](https://github.com/voyagi/claude-usage/commit/9a1db57be3a9408af67558aa02aaee520870fe11))
* **04-02:** add formatTimeUntilLimit for rate limit ETA display ([6560114](https://github.com/voyagi/claude-usage/commit/656011450573df7fd2df17a5914357675ce909b0))
* **04-02:** add urgency scoring and fix session reset time ([a323432](https://github.com/voyagi/claude-usage/commit/a3234324216adad1508009ba5605e41eb972f450))
* **04-03:** add rate limit detector and user config schema ([76aff99](https://github.com/voyagi/claude-usage/commit/76aff9935968ebf7b0675a72b041ce94067e423d))
* **04-03:** create CredentialsWatcher for auto tier detection ([e210d1e](https://github.com/voyagi/claude-usage/commit/e210d1ea6d62e1b418e6e18da255d28bc3c17e74))
* **04-04:** enhance status bar with configurable thresholds and burn rate predictions ([7ba6a9a](https://github.com/voyagi/claude-usage/commit/7ba6a9aad7b5a9046e2c0b32472c664a4e65ef1b))
* **04-04:** wire Phase 4 components into extension ([c38bec5](https://github.com/voyagi/claude-usage/commit/c38bec5b442d021f17154513b1ef3ac36d2ccdc7))
* **04-05:** detect rate limit events in incremental parser and surface via SessionWatcher ([ea16259](https://github.com/voyagi/claude-usage/commit/ea16259a0b35d932d0448813ccea5d618c107e15))
* **04-05:** handle rate limit events with persistence and refined limit application ([c73ed6f](https://github.com/voyagi/claude-usage/commit/c73ed6f33a145a717156a4d0f2d1ff1ff025d80a))
* **04-06:** add per-model weekly aggregation to TimeBuckets ([02552a9](https://github.com/voyagi/claude-usage/commit/02552a9c15821cd3b19218c1281ba10ae19476c1))
* **04-06:** filter weeklySonnet to claude-sonnet-* models only ([4d84d22](https://github.com/voyagi/claude-usage/commit/4d84d22e629e256398831ef67501c1d4c49c5a45))
* **05-01:** configure dual esbuild bundling and JSX support ([9676a07](https://github.com/voyagi/claude-usage/commit/9676a072fcd54129a0549c2b5a0573f6fd298914))
* **05-02:** create DashboardProvider for sidebar webview ([6497efe](https://github.com/voyagi/claude-usage/commit/6497efe6ccddca425c39c799a393b459c48be3db))
* **05-02:** define message types for extension-webview communication ([cec176b](https://github.com/voyagi/claude-usage/commit/cec176bbf09444bdaaec367e1f7513809e03543f))
* **05-03:** build Overview tab with comprehensive metrics ([e66cfa5](https://github.com/voyagi/claude-usage/commit/e66cfa5de49247100e5486cdffeb5385c5208b83))
* **05-03:** create React entry point and App root with tab navigation ([d220b51](https://github.com/voyagi/claude-usage/commit/d220b514768324f927a7b1d3882ff10d0321b4db))
* **05-04:** add SegmentedControl and UsageChart components ([e02e693](https://github.com/voyagi/claude-usage/commit/e02e69315a9d24ba478042d2ff20ef6a069d3ea1))
* **05-04:** add TrendsTab with chart and data table ([c3dd08f](https://github.com/voyagi/claude-usage/commit/c3dd08f6588fa23114941f6fa72967409384f3e6))
* **05-05:** implement Session tab with session comparison ([c1d4ed1](https://github.com/voyagi/claude-usage/commit/c1d4ed195003d4070560b0a75015ca5e15f9309e))
* **05-05:** wire all three tab components into App.tsx ([90f987f](https://github.com/voyagi/claude-usage/commit/90f987f4014751d631fb7121d082d96cb3b22a39))
* **05-06:** add buildDashboardData transformation to DashboardProvider ([6828ad7](https://github.com/voyagi/claude-usage/commit/6828ad7f68bf97d36d00e1186c2baeecbb213e03))
* **05-06:** wire DashboardProvider into extension and update status bar command ([82bf225](https://github.com/voyagi/claude-usage/commit/82bf2257a66e3537401d19a58f3912ca21748258))
* **06-01:** add activation guard and command palette commands ([eba6848](https://github.com/voyagi/claude-usage/commit/eba684877441733afa9c2d99dbba3194d8566fbb))
* **06-02:** add trust UX components ([97c9c64](https://github.com/voyagi/claude-usage/commit/97c9c6470f8cec2113b1174c308f3596d60ce180))
* **06-02:** add trust UX data plumbing ([2f50a98](https://github.com/voyagi/claude-usage/commit/2f50a98a11b32f270b67399304f137534bba2cda))
* API-first reliability overhaul ([#12](https://github.com/voyagi/claude-usage/issues/12)) ([ad28ae5](https://github.com/voyagi/claude-usage/commit/ad28ae522d5081b103a003f1af34bcbf47a86847))
* **api:** OAuth token refresh with automatic credential persistence ([913a1ad](https://github.com/voyagi/claude-usage/commit/913a1addf8ee7fa7b22b27fd7eb597b4e40e0c0a))
* **ui:** add real-time API usage and color-coded status bar ([ddf9afd](https://github.com/voyagi/claude-usage/commit/ddf9afdbf67cf469e6bc06ad9a617f252964a87c))


### Bug Fixes

* **01-04:** wire loadUsageData and plan selection ([00c3393](https://github.com/voyagi/claude-usage/commit/00c339392f32b8de88d46b2d62bd73e44b56560f))
* **03:** revise plans based on checker feedback ([4639b49](https://github.com/voyagi/claude-usage/commit/4639b49941a7345335d99be2506f04653046846d))
* **05:** revise plans based on checker feedback ([d65744a](https://github.com/voyagi/claude-usage/commit/d65744a54663b17cfa1cb47a90c760ef6752a1ed))
* **api:** auth state machine to permanently fix recurring data staleness ([#15](https://github.com/voyagi/claude-usage/issues/15)) ([b7c29cc](https://github.com/voyagi/claude-usage/commit/b7c29cc1a049731fdabc9743c30f3ab806fb90f2))
* **deps:** override underscore and undici to resolve 7 Dependabot alerts ([#16](https://github.com/voyagi/claude-usage/issues/16)) ([c90c2d8](https://github.com/voyagi/claude-usage/commit/c90c2d8e43f38a6d911ee6e1d8416213f577878b))
* **deps:** resolve 3 HIGH minimatch vulnerabilities ([#3](https://github.com/voyagi/claude-usage/issues/3)) ([fa577f9](https://github.com/voyagi/claude-usage/commit/fa577f9dde16299040bcac640a83592cc8c511e8))
* fix-all audit fixes (lint, tests, gitignore) [skip-review] ([#14](https://github.com/voyagi/claude-usage/issues/14)) ([b1eb075](https://github.com/voyagi/claude-usage/commit/b1eb075a3302f4ef0304524ffd7b57583348bec9))
* relax staleness thresholds for rate limit data and log 401 auth errors ([1c2f2ce](https://github.com/voyagi/claude-usage/commit/1c2f2ce1b0eeb6fb1e7e953295ce669f601ed86d))
* resolve challenge review findings (10 bugs + perf) ([#9](https://github.com/voyagi/claude-usage/issues/9)) ([bfcfde4](https://github.com/voyagi/claude-usage/commit/bfcfde49d98cee12d8d7c960d1908785a80f0043))
* **ui:** stop greying out status bar for dim staleness (1-2h old) ([#17](https://github.com/voyagi/claude-usage/issues/17)) ([6984bc8](https://github.com/voyagi/claude-usage/commit/6984bc892211e7404bbcbbbc23b704fea30d013f))

## [1.0.0] - 2026-02-08

### Added

- Always-on status bar showing tokens, cost, and rate limit proximity
- Color-coded usage thresholds (green/yellow/red)
- Burn rate display with time-until-limit prediction
- Cooldown timer counting down to session window expiry
- Compact mode for narrow windows
- Sidebar dashboard with three tabs:
  - Overview: token breakdown, rate limits, session timing
  - Trends: stacked bar charts with daily/weekly/monthly views
  - Session: current vs. average session comparison
- Rate limit intelligence:
  - 5-hour rolling session window tracking
  - Auto-detection from observed 429 events
  - Per-model weekly Sonnet limit tracking
  - Configurable warning thresholds
- Auto-detection of Claude plan tier from credentials
- 12 command palette commands (refresh, export, plan switch, etc.)
- JSON data export (summary + raw time buckets)
- Activation guard (silent when ~/.claude/ not found)
- Trust-first design: zero network calls, zero telemetry
- Support for Pro, Max 5x, and Max 20x plans
- Configurable pricing overrides
