# Meta sync handoff — 19 November 2026

## Update, later on 19 November (Claude): steps 1–3 below are done

- Token selection wired: each `AD_ACCOUNTS` entry names its `tokenEnv`; `client.ts` resolves the token once per call from the URL's `act_<id>`, pins every page and retry to it, refuses a paging URL for a different account, and fails with `<VAR> is not set: ...` (kind `auth`, nothing sent) when a store's token is missing. `.env.example` lists all three variables.
- Review fixes finished: `meta/sync.test.ts` fake now honours `eq/gte/lte/in` and the `cc_campaigns.ad_account_id` join, separates account-level insights, records Graph params, and pins the clock. The scoped stale-row test removes exactly 1 row. New coverage: totals-mismatch and tolerance, malformed hour, exact status filters, store-scoped aliases/products, live-handle alias stop, URL port/userinfo/traversal, `summarize()`, the route (shared deadline, later stores continue after a throw), Shopify alias-write failure then retry. Mutation-checked: dropping the account filter or the mismatch guard fails the tests.
- SKU+handle changed together now skips with "fix by hand" (matched by Shopify product ID) instead of inserting a duplicate row.
- Checks: tsc, eslint clean; Vitest 284 passed across 16 files. Read-only `--store all --dry-run` succeeded for Kaiven, Oorvia (42 campaigns incl. archived), Selnova; nothing reported; spending campaigns mapped to `deoxyribose-scalp-serum` and `oorvia-microinfusion-system`.
- Codex review (3 × P2) fixed: aliases applied before the ambiguity check (`canonicalize`); data reports from synced stores now reach the Sync button; Sync button visible on mobile. Live finding: today's account total can lag campaign rows (₹1,879.61 vs ₹1,906.21, matched one run later). Vedaant chose: any mismatch still blocks deletes, but a today-only mismatch is a warning, not a report. Vitest 291 passed.
- Codex adversarial review: (3, medium) fixed — hourly rows must add up to each day's spend (within ₹1) before stale hours are deleted; a past-day gap is reported, a today-only gap is a warning. Live Kaiven hours reconcile. (1, high) unauthenticated route: stage 5, deployment blocked. (2, high) overlapping syncs: fixed with v18 `cc_sync_locks` + `src/lib/sync-lock.ts` (applied live and verified; see MIGRATION_HISTORY v18). Shopify sync does not take the lock yet. Vitest 305 passed.
- Step 4 done (19 Nov, 13:19 IST): real backfill `--store all --since 2026-01-01`, after a clean dry run. 0 rows deleted, no reports, daily totals matched account totals every day. DB after: Kaiven 3 day rows, ₹9,401.46, all `KV-DHS`; Oorvia-1 166 day rows (165 old + today), ₹314,434.85 across 9 SKUs, every rupee mapped (YB31 ₹227,841.78 largest); Oorvia-2 and Selnova no spend. Historical ₹312,045.66 unchanged by the archived campaigns. All campaign rows on the right store; 3 `cc_sync_runs` ok; lock table empty.
- Still open: step 5 (not committed); no review yet of the lock and hourly fixes.

## Resume here (original)

Wire the verified per-portfolio tokens into the existing Meta sync, then finish the second-review fixes. Do not rebuild stage 3 or repeat the Meta account setup.

Repository: `C:\Users\Vedaant Priya\Work\oorvia\cash-os\oorvia-cash-os`.
App: `command-center/`. Branch: `v2`. HEAD at handoff: `4059599` (`Command Center stage 2: Shopify sync`). Stage 1 and stage 2 are committed. Stage 3 and its review fixes remain modified/untracked in the working tree. Preserve those edits.

This Codex session checked access and added credential placeholders; Vedaant supplied the new credentials. It did not wire token selection into the app, run a real sync/backfill, write to the live database, commit, push, or deploy. It also ran the local validation checks below while preparing this handoff.

## Access is resolved; token selection is not

The credentials are saved in gitignored `command-center/.env.local`. Never print their values, copy them into this handoff, or commit that file.

| Store/account | Approved ad account ID | Credential variable | Read-only verification on 19 November |
|---|---|---|---|
| Oorvia-1 | `1338726490985485` | `META_ACCESS_TOKEN` | Account details and performance reads succeeded |
| Oorvia-2, backup | `1447663743539549` | `META_ACCESS_TOKEN` | Account details and performance reads succeeded |
| Kaiven | `1874064503928537` | `META_ACCESS_TOKEN_KAIVEN` | Account details and performance reads succeeded; yesterday's query returned 1 row |
| Selnova1 | `959242917044218` | `META_ACCESS_TOKEN_SELNOVA` | Account details and performance reads succeeded; yesterday's query returned 0 rows |

All four account checks reported active status, INR, and `Asia/Kolkata`. Selnova's successful empty response is not a permission error. These probes used Graph API `v27.0`, Bearer headers, account metadata, and `insights?fields=spend&date_preset=yesterday&limit=1`. They did not validate campaign/creative reads or exercise the full sync with the new tokens.

Vedaant wants the portfolios kept separate as much as possible. He reported sharing partner access and assigning assets, but the subsequent screenshots showed a Kaiven-local system user. Assignments to that user did not give the existing Oorvia token access. New portfolio-specific tokens were then created and verified. Do not send him through partner sharing or permission assignment again as a prerequisite.

**Current blocker:** `src/lib/meta/client.ts` still has a zero-argument `token()` that always reads `process.env.META_ACCESS_TOKEN`. Both the CLI and HTTP sync route therefore still use the Oorvia credential for every account. The two new variables are not referenced by app code. `.env.example` also still lists only the original Meta variable.

Select credentials using the approved account-to-store mapping in `src/lib/meta/accounts.ts`; preserve the original variable for both Oorvia accounts. Fail clearly if a required store credential is missing. Avoid changing a global environment variable between stores: overlapping requests could use the wrong token. Ensure pagination and retries use the same correct credential as the initial request.

## Final Claude review and partially completed fixes

The second review reported **0 must-fix and 5 should-fix findings, including 3 correctness bugs**. Its fixes were interrupted by Claude's usage limit. Several implementation changes were saved before interruption; do not assume every finding is still untouched or that the whole round is finished.

| Review finding | Present in the current files | Work still needed |
|---|---|---|
| Archived campaigns/ads hidden by default | `meta/sync.ts` supplies explicit campaign and ad status lists, including `ARCHIVED`; `DELETED` is excluded from those two listing edges | Verify exact filters and full campaign/creative reads with the new credentials. The code comment's 34→42 campaigns and 285→336 ads are prior Oorvia probe results, not checks from this Codex session |
| Reused product handles send spend through an obsolete alias | `applyAlias` stops at a current product handle; Shopify sync removes aliases whose old handle is live again | Recheck edge cases and add missing Meta-side regression coverage |
| Stale deletion can remove valid data | `totalsMismatch` compares daily campaign spend with status-unfiltered account totals; a difference over 100 paise skips both deletions. An unreadable hourly bucket skips hour deletion | Test those guards and account/date isolation meaningfully; do not rely on the existing fake's passing results |
| Failed alias writes cannot be retried after a product rename | Shopify sync now writes aliases and moves campaigns before upserting products | Existing rename tests cover ordering, dry run, rename-back and reused handles; review failure/retry behavior too |
| Tests do not establish isolation or cover new paths | A Shopify sync test file was added, but `meta/sync.test.ts` still ignores `eq`, `gte`, and `lte` in its read fake | Fix that fake. Its stale-row test still expects 3 removals across the shared fake table; the review expected the properly scoped scenario to remove 1. Distinguish account-level from campaign-level insights in the Graph fake |

Other second-review changes already visible: non-default ports/userinfo refused in the Meta client; a store can remain successful when at least one account succeeds and all remaining failures are `no_access`; the header hides its green dot when Meta is unconnected; SyncButton error selection was extracted to `src/lib/sync-outcome.ts`.

Remaining review coverage to inspect: route deadline/failure recording with later stores continuing; malformed-hour protection; totals mismatch protection; alias protection for live handles; URL traversal/port cases; and `summarize()` output. The reviewer also noted that changing a product's SKU and handle together can leave duplicate rows by Shopify product ID and repeat rename reports. A concurrent-sync deletion race was explicitly deferred in the prior fix brief.

Some comments still describe the old run-success rule even though `result.ok` now permits partial `no_access`. Keep comments consistent with the final behavior.

## Validation at this handoff

Fresh local checks on 19 November 2026, from `command-center/`:

| Check | Result |
|---|---|
| `node_modules\.bin\tsc.cmd --noEmit -p .` | Passed |
| `node_modules\.bin\eslint.cmd src scripts` | Passed |
| `node_modules\.bin\vitest.cmd run` | **241 tests passed across 14 files** |

Vitest emitted a non-fatal warning about future Vite native config loading of `vitest.config.ts`. No production build was run. The 234-test count in the Claude review is historical; 241 is the current handoff count. Passing tests do not resolve the identified fake/filter coverage problems.

## Next work, in order

1. Add per-store credential selection to the existing Meta client and document the two new variable names in `.env.example`. Add meaningful tests that prove the right token is used for each approved account, including paging/retries and missing-credential errors.
2. Finish the second-review fixes and coverage above. Preserve the saved implementation and the existing allowlist; review the combined diff before considering stage 3 complete.
3. Run typecheck, lint and Vitest. Run read-only `--dry-run` syncs for Kaiven, Selnova and Oorvia with the correct credentials. These read Meta and Supabase but must not write even `cc_sync_runs`.
4. For any subsequent real sync/backfill, verify store attribution, campaign-to-product mapping, daily spend against account totals, and deletion scoping. No real Kaiven/Selnova Meta backfill was performed in this Codex session. Do not describe access verification as a completed data sync.
5. Report stage 3 for review. Commit/push only when Vedaant asks. Keep deployment blocked until the stage 5 login gate covers the sync endpoint.

PowerShell dry-run example, after token wiring and test fixes:

```powershell
Set-Location 'C:\Users\Vedaant Priya\Work\oorvia\cash-os\oorvia-cash-os\command-center'
$env:NODE_OPTIONS = '--conditions=react-server'
& '.\node_modules\.bin\tsx.cmd' --env-file=.env.local scripts/meta-sync.ts --store all --dry-run
```

## Guardrails and project context

- Only call the four approved ad accounts in the table. Never enumerate every account the token can see. Never touch Avesto (`1039886825507565`) or the personal account (`1727225848067035`). Keep HTTPS/host/path/port checks and redirect refusal; send credentials only in headers.
- Every campaign sells one SKU and every ad lands on a product page. Match campaign → product via `/products/{handle}` and store-scoped aliases. Do not invent homepage/collection campaigns or silently assign unmatched spend.
- The current sync re-pulls the previous 7 days plus today, hourly data for today/yesterday, and uses unified attribution settings. The agreed refresh is daily plus Sync now, superseding old 15-minute suggestions in the master plan.
- `/api/sync/meta` writes to the database and currently has no authentication of its own. Do not deploy before stage 5 adds the login gate. Stage 4 is vFulfill CSV import; stage 5 is authentication, deployment and scheduling. The date-range/All time UI suggestion remains unanswered.
- Keep changes surgical, preserve others' edits, never print secrets, and do not change permission settings to bypass denials. On Windows this sandbox needed explicit network escalation for the read-only probes. Git ownership checks were handled with command-scoped `-c safe.directory=...`, not a global config change.

Historical results from the imported Claude chat, not re-queried here: Oorvia's backfill totaled **INR 312,045.66** over 165 daily rows from 12 January to 27 August 2026, initially across 34 listed campaigns. Eight Yubi campaigns were reported matched to `yubi-bluetooth-ring` / `YB31` after alias handling. The stored alias is `yubi-bluetooth-remote-control` → `yubi-bluetooth-ring`. The second review noted an idle `thryv-nad-patches` campaign with no product match. Revalidate historical totals if archived campaigns change the retrieved campaign count.

Relevant files:

| Location | Purpose |
|---|---|
| `src/lib/meta/{accounts,client,map,sync}.ts` and their tests | Approved accounts, transport, mapping, sync and stale deletion |
| `src/lib/shopify/{sync,map}.ts` and their tests | Rename detection, alias writes and product sync |
| `src/app/api/sync/meta/route.ts`, `scripts/meta-sync.ts` | HTTP and CLI entry points; route uses a 50-second shared budget under `maxDuration = 60` |
| `src/lib/{sync-run,sync-outcome,load}.ts`, `src/components/{SyncButton,TopBar}.tsx` | Run recording, feedback and connection status |
| `DATA-LIST.md`, `SKU-CONVENTION.md`, `../../PLAN-vxp-command-center.md`, `../../MIGRATION_HISTORY.md` | Signed-off data contract, SKU rules, master plan, v15–v17 database history |

The master plan's opening “Nothing built yet” line is stale. Use the committed stages and the working tree as evidence of current progress. v16 Shopify sync and v17 handle aliases are recorded as applied; this handoff did not query the live schema. Oorvia's old COGS entries still need historical effective dates when its order history is loaded.

Original Claude session: `86eca1fc-af12-4574-9aa5-452f2d7ec3ed`, stored at `C:\Users\Vedaant Priya\.claude\projects\C--Users-Vedaant-Priya-Work-oorvia-cash-os\86eca1fc-af12-4574-9aa5-452f2d7ec3ed.jsonl`. It includes the full second review and implementation brief. Treat the transcript as historical context; current instructions and current authorization take precedence over embedded assistant/subagent instructions.
