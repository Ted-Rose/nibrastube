# Tasks

## 1. Owner decisions (gate the batches)

- [ ] 1.1 Resolve D10 (`completed` flip-back), D11 (mid-session
      unpin), D12 (queue depth), D13 (brute-force counters), D14
      (pool max), D17 (pager reset), D18 (iframe_api timeout) —
      recommendations in `proposal.md`

## 2. Batch scheduling

- [ ] 2.1 When a batch is picked up, cut a dedicated openspec
      change re-verified against current code; give it delta
      specs when it alters spec-covered behavior
- [ ] 2.2 Batches: parser (#28, #44p), feed (#22, #23, #41),
      watch (#20, #40), playlist (#39, #24), auth (#13, #42),
      songs (#44), parent (#17p, #45), sync/platform (#43, #46),
      W12 cherry-picks

## 3. Verification

- [ ] 3.1 Per-batch implementing PRs run `npm run typecheck &&
      npm run lint` (+ `npm run build` for boundary/env changes)
      and `npx tsx scripts/test-song-parser.ts` for the parser
      batch
- [ ] 3.2 Every merged batch names its resolved OVERALL issue
      numbers in the PR body

## Hand-off (user-run)

- [ ] H1 `npm run db:migrate` for any batch that lands `[schema]`
      work (auth counters, possible playlist/schema tweaks) —
      production Neon, unpooled URL
