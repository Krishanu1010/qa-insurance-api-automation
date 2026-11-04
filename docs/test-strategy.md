# API test strategy

## Objective

Provide repeatable release confidence for an insurance policy and claims API, including resource lifecycle behavior, authorization boundaries, validation, and operational API semantics.

## Risk based scope

| Priority | Risk | Planned coverage |
|---|---|---|
| P1 | Unauthenticated or under-scoped clients read or change protected data | OAuth token issuance, missing/invalid token, and scope authorization |
| P1 | Policy creation or updates accept invalid business data | Positive and negative lifecycle, boundary and equivalence partitions |
| P1 | Claims are attached to the wrong policy or duplicated | Chained policy-to-claim workflow and idempotency-key replay |
| P1 | API contract changes break consumers | JSON Schema, content type, headers, and status assertions |
| P2 | Lists omit or duplicate records | Pagination, filters, sorting, and boundary page sizes |
| P2 | Clients mishandle throttling or transient API errors | Rate-limit response and `Retry-After` behavior |
| P2 | Methods have incorrect semantics | GET/POST/PUT/PATCH/DELETE lifecycle and idempotency checks |

## Test techniques

- **Positive:** valid policy and claim workflows confirm supported business paths.
- **Negative:** missing, malformed, unauthorized, or conflicting requests confirm clear safe failures.
- **Equivalence partitions:** representative valid and invalid values exercise each input class without testing every possible value.
- **Boundary values:** minimum/maximum limits and values just outside those limits target common off-by-one and validation defects.
- **Data driven:** shared scenario rows exercise multiple policy and claim input classes consistently.
- **Chained requests:** create a policy, submit a claim using its identifier, then retrieve both resources to confirm linkage.
- **Idempotency:** repeat an identical request with the same key and verify that it does not create a second claim.
- **Contract validation:** check schemas and protocol metadata alongside explicit business assertions.

## Isolation and reliability

Use unique synthetic identifiers, no shared mutable test records, and Playwright worker-scoped request contexts. The local server resets state at process startup. Parallel tests should not depend on order. Rate limiting is tested with a controlled demo behavior so unrelated tests do not race over one shared quota.

## Database and performance scope

The local target mirrors policy, claim, and idempotency writes to an embedded SQLite file while its in-memory store remains canonical and resets at server startup. Selected integration checks read those rows through a helper that issues only SELECT queries after API calls. This checks API-to-storage mapping only; it does not prove durable database-backed business behavior, a real insurer database, or staging data correctness. The release gate does not claim load or benchmark results; rate-limit behavior is an API functional check, not a load test.

## Entry and exit criteria

**Entry:** supported Node/pnpm versions and a frozen dependency install. The API-only suite uses `APIRequestContext` and does not require browser binaries.

**Exit:** all P1 scenarios pass locally and in CI; failures produce actionable request/response context without exposing secrets; report generation succeeds; the repository documents known scope limits.
