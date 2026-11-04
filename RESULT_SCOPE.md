# Jerry monthly matching scope

`--scope both-new` remains the default: window jobs × window candidates.
`--scope either-side` includes every pair with either side created in the
Asia/Shanghai date window, paginating all jobs and all CANDIDATE people.
Pairs and existing results are deduped by candidate/job ID; pairs with neither
side in the window are excluded. Plan scope is `either-side-created` or
`new-jobs-x-new-candidates`.

Missing pairs are sorted by the earlier side's creation time, then candidate ID
and job ID, before applying the limit. Concurrent runs may finish out of order.
The default month window and dry-run behavior are unchanged.

Validation: `nice -n 10 node --test ops/recruiting/match-month.test.mjs` —
16 tests passed using offline mocks. No service calls or deployment changes.
