# Firebase competition and round lifecycle API

For GitHub review, see [the API technical design and test evidence](../docs/API_TDD.md)
for exact contracts, integration limitations, and commit-hygiene findings.

This package implements **round-based submission and admin lifecycle APIs**. It uses Firebase
callable functions and team-owned service interfaces, with local mocks until the
Firestore integration is supplied. It contains no game engine, Firestore schema,
security rules, leaderboard calculation, or matchmaking. Lifecycle endpoints
orchestrate service contracts; game and tournament algorithms remain team-owned.

The original FastAPI/SQLite application and its 27 tests were not transferred.
The team root README remains the high-level design authority.

## What changed

| Callable | Phase 1 behavior |
| --- | --- |
| `joinCompetition` | Verified-email registration through registration/data services; see below. |
| `submitAllocation` | Preferred MVP write: create or replace a player's allocation for one competition round. |
| `submit_game` | Deprecated name retained as an alias of `submitAllocation`. Accepts the **new round request**, not the old match payload. |
| `get_submission_status` | Migrated to competition/round IDs; returns only the caller's submission metadata. |
| `admin_inspect_game` | Retained, with a round-based request; admin-only metadata inspection, never hidden allocations. |
| `get_game_result` | Deprecated migration stub: authenticated callers receive `failed-precondition / direct_reads_required`. Read published results directly from Firestore instead. |
| `admin_request_finalization` | Deprecated migration stub: requires admin; returns `failed-precondition / round_lifecycle_deferred`. Use the four explicit admin lifecycle callables below. |

No existing callable name was deleted. Old match request shapes are intentionally
rejected: translating a match ID into a competition round would require an
agreed team mapping and could bypass eligibility/deadline checks. All submission
writes, including the deprecated alias, use the same round service.

The old `game_api/api.py`, `contracts.py`, and `mocks.py` match-based implementation
is retained as reference. `api.py` also supplies shared identity/error/identifier
types. The Functions runtime now constructs `RoundAPI`, never the legacy `GameAPI`.

## How the pieces communicate

```text
Signed-in frontend
  -> Firebase callable transport verifies the Firebase Authentication token
  -> main.py gets the trusted UID and maps errors to Firebase HttpsError
  -> RoundAPI validates IDs, eligibility, open state, deadline, and allocation
  -> RoundSubmissionService atomically creates/replaces the allocation
  -> team's Firestore adapter (currently a process-local mock)

Frontend -> Firestore reads -> published results, standings, leaderboard
                         -> access controlled by the team's Security Rules
```

The API checks whether a request is allowed and correctly formed. The data layer
owns saving it safely. The game engine later compares allocations within groups
and computes results. The API neither knows group pairings nor calculates winners.

All production writes go through the team's Python callable functions. Direct
client writes must be denied by the team's Security Rules. The server Admin SDK
bypasses those rules, so backend checks and IAM remain necessary. No Firestore
paths or rules are invented in this package.

## Request and response

Call `submitAllocation` with:

```json
{
  "competition_id": "competition-1",
  "round_id": "round-1",
  "allocation": [10,10,10,10,10,10,10,10,10,10]
}
```

Firebase Authentication supplies the caller's UID. Do not include a UID, admin
flag, match ID, deadline, or game-mode override. Extra fields are rejected.

Identifiers are strings of 1–128 characters, beginning with a letter/digit and
using only letters, digits, `_`, `.`, `:`, or `-`. Malformed requests, non-JSON
values, and requests larger than 64 KiB after API JSON serialization are rejected.
These transport limits are proposed API contracts, not a database schema.

The service supplies an `AllocationConfig` containing the game-mode identifier,
soldier total, battlefield count, and configuration version. The MVP defaults
are `colonel-blotto`, 100 soldiers, 10 battlefields, version `mvp-1`.
Game-mode identity and limits are authoritative server configuration, not
client-selected rules. Configuration support is limited to allocation validation;
no speculative game modes or alternative scoring engines are implemented.

Allocations must be lists of exactly the configured number of nonnegative
integers totaling the configured soldier count. Booleans, floats, strings, nulls,
negative values, and nested lists are rejected. Zero soldiers on a battlefield
is valid. Array positions correspond to battlefields in order.

A successful receipt looks like:

```json
{
  "competition_id": "competition-1",
  "round_id": "round-1",
  "game_mode": "colonel-blotto",
  "submitted": true,
  "revision": 1,
  "saved_at": "2026-10-27T12:00:00+00:00"
}
```

The timestamps shown are examples. `saved_at` comes from the service's trusted
clock. One logical allocation is stored per competition/round/player. Repeated
valid calls replace it; even identical retries succeed and increment revision.
No duplicate error or scoring side effect is generated. The last committed valid
write wins, not necessarily the request sent last by the browser. There is no
client revision precondition in this initial MVP.

For `get_submission_status` and `admin_inspect_game`, send only:

```json
{"competition_id":"competition-1","round_id":"round-1"}
```

Status returns those IDs plus `submitted`, `revision`, and `saved_at`; revision
and timestamp are null when the caller has not submitted. It remains readable
after round closure for registered active players. It never returns an allocation,
opponent status, group metadata, standings, or unpublished results.

Admin inspection requires the verified custom claim `admin: true` (claim name
configurable by the team). It returns IDs, round state, deadline, game-mode ID,
and submitted-player count. String `"true"` and number `1` do not grant admin
access. Admins do not bypass eligibility/deadline checks on submission calls.

Frontend submission example after the team integrates Firebase:

```javascript
import { getFunctions, httpsCallable } from "firebase/functions";

// Sign in using the team's Firebase Authentication integration first.
const submit = httpsCallable(getFunctions(), "submitAllocation");
try {
  const response = await submit({
    competition_id: "competition-1",
    round_id: "round-1",
    allocation: [10,10,10,10,10,10,10,10,10,10]
  });
  console.log(response.data.revision);
} catch (error) {
  console.log(error.code, error.details?.reason);
}
```

## Deadline and atomic-save contract

Both the API precheck and the save service require an authenticated, registered,
active player; an open round; and `server_now < deadline`. At exactly the deadline,
submission is rejected. Deadlines must be timezone-aware server timestamps.
Submitting cannot extend the deadline, open a round, or change game settings.

`RoundSubmissionService.replace_allocation` MUST enforce the following in its
Firestore transaction, not just in an earlier API read:

1. Re-read registration/active status, round state, deadline, and configuration.
2. Compare current configuration and version with the API's expected configuration.
   A changed config rejects the stale request; refresh before retrying.
3. Check a fresh trusted server time on every transaction attempt. Reject if
   the round is closed or the deadline has arrived. Never trust browser timestamps
   or a time sampled before a queue/transaction retry.
4. Validate the allocation against that authoritative configuration.
5. Atomically replace the player's single allocation and increment its revision.
   Return the committed revision and timestamp only after success.

State/config/eligibility reads must participate in conflict detection with their
writers. Concurrent valid edits should serialize; exhausted transaction retries
map to `conflict`. The data team must agree on the exact authoritative time and
transaction acceptance boundary; the API alone cannot enforce commit-time policy.
Firestore may rerun transaction callbacks: keep scoring, awards, external calls,
and other side effects out of submission transactions.

The mock uses a lock and a fresh injected server clock inside the critical
section. Tests simulate deadlines, closure, elimination, and config changes
between precheck and save. This demonstrates the contract; it does not verify
Firestore transaction behavior or provide durable multi-instance storage.

## Consistent errors

Application errors use `HttpsError(code, message, details={"reason": ...})`.
Firebase clients expose codes with the `functions/` prefix.

| Code | Reason / meaning |
| --- | --- |
| `unauthenticated` | `authentication_required` |
| `permission-denied` | `player_ineligible` (unregistered or eliminated), `admin_required` |
| `invalid-argument` | `invalid_request`, `invalid_allocation` |
| `not-found` | `not_found`: unknown competition or round |
| `failed-precondition` | `round_not_open`, `deadline_passed`, `configuration_changed`, `direct_reads_required`, `round_lifecycle_deferred` |
| `aborted` | `conflict`: transaction contention; retry only while still open |
| `unavailable` | `unavailable`, `invalid_configuration`, `services_not_configured` |
| `internal` | `internal`: unexpected or unrecognized adapter failure |

The API never echoes an invalid allocation or internal exception text. Adapters
must return stable `ServiceError` reasons, not expose database diagnostics.
Unregistered/eliminated players receive the same eligibility message; the mock
checks eligibility before disclosing round existence in a known competition.
The Firebase SDK can reject malformed envelopes or invalid ID tokens before our
handler runs; those transport errors may not have `details.reason`.

Do not log private allocations or tokens. Result publication and direct-read
privacy must be enforced by the team's Firestore projections and Security Rules;
being submitted or scored does not automatically make results public.

## Game engine contract — documented, not implemented

For the initial MVP, the engine compares the same round allocation against other
players in the player's group. More won battlefields wins a match. Equal soldiers
on a battlefield gives neither player a battlefield win. A match win earns 1
point, a match tie 0.5, and a loss 0. The API never calculates any of these values.

Publishing results, standings, and leaderboard documents is owned by the team's
engine/data services. The frontend reads their published projections directly.

## What is needed from teammates

| Owner | Needed for integration |
| --- | --- |
| Firebase/Auth | Project/runtime/region, UID convention, registration identity mapping, trusted admin claim assignment, revocation handling, emulator users, and optional App Check configuration. |
| Data access | Implement `RoundSubmissionService` in `round_contracts.py`: `get_context`, atomic `replace_allocation`, eligibility-checked `own_status`, and metadata-only `inspect_round`. Own schemas, rules, IAM, authoritative timestamps, transaction retry mapping, and deployment wiring. |
| Competition owner | Confirm ID conventions, active/eliminated meaning, status access after elimination, deadline boundary, concurrent-edit semantics, configuration/version ownership, and whether configuration can change after a round opens. |
| Game engine/publication | Consume final round allocations, compare group players, compute scores, and expose published read projections. Own idempotent scoring/awards and publication privacy. |
| Frontend | Adopt `submitAllocation` and round request fields; read published data through agreed Firestore paths/rules. |

Defaults chosen where the high-level design is silent: exclusive deadline,
server-owned mode/configuration, identical retries accepted, last committed edit
wins, ineligible players cannot use status, and admins inspect metadata only.
These are explicit integration contracts for team confirmation.

## Phase 2 — admin round lifecycle

All four callables require verified Firebase Authentication and the configured
boolean admin claim. They use the same error envelope and 64 KiB request limit as
Phase 1. Requests reject extra fields, including seeds, scores, allocation data,
and client-provided admin identities. Only explicit safe response fields are sent.

Lifecycle payloads use `competition_id` and strict positive-integer `round_number`.
The round service owns the mapping to the opaque `round_id` used by Phase 1;
the API does not invent that mapping. These field names extend the existing
snake_case frontend payload convention; new names and revision requirements need
frontend coordination. The function names are exactly `openRound`, `closeRound`,
`scoreRound`, and `publishRound`.

### openRound

```json
{"competition_id":"demo","round_number":1,"deadline":"2026-11-01T18:00:00Z"}
```

The deadline must be a timezone-aware ISO 8601 string. It is normalized to UTC.
The service verifies the deadline is strictly in the future using fresh trusted
time at creation, then creates the open round, its trusted MVP configuration, and
a stored server-generated random seed together. Seeds are never accepted from
clients or returned. Repeating the same round/deadline returns current metadata,
even if the deadline has since passed or the round has progressed. It does not
reopen the round or regenerate its seed. A different deadline for that existing
round returns `already-exists / round_conflict`.

### closeRound

```json
{"competition_id":"demo","round_number":1}
```

Closure is allowed at or after the deadline. Early close returns
`failed-precondition / deadline_not_reached`; no force-close option is introduced.
The API delegates one atomic logical operation to the round service: freeze the
accepted submission snapshot, eliminate non-submitters, draw groups using the
stored seed, and commit the closed state. The API does not draw groups or choose
eliminations. Repeated close requests return current metadata without repeating
effects, including after scoring/publication. Closed/scored/published rounds no
longer accept submissions through either Phase 1 submission name.

### scoreRound

Initial scoring:

```json
{"competition_id":"demo","round_number":1,"idempotency_key":"score-1"}
```

The API verifies the round is closed (or scored for retries/rescoring) and asks
`RoundScoringService` to durably accept an engine job. No comparisons, rankings,
tiebreakers, or scoring algorithms run in the API. Pending/failed work remains
`closed`; successful worker completion marks it `scored` with status `completed`.
Scoring does not publish results or advance/award players.

Retry the same key and arguments to retrieve current stored scoring status
without creating another job. Keys are scoped per competition/round/scoring
operation across admins. Reusing a key for different arguments conflicts.
A different key cannot launch another job while one is queued/running.

Explicit rescore after successful or failed scoring, before publication:

```json
{
  "competition_id":"demo","round_number":1,
  "idempotency_key":"rescore-2","rescore":true,"expected_scoring_revision":1
}
```

Rescoring requires a new key and the current revision. It increments that revision,
invalidates the earlier completed score, and returns the round to `closed` while
the new job runs. Unpublished results stay private. Stale worker completions must
be rejected by revision so they cannot overwrite newer results. Failed scoring
requires the same explicit rescore process; there is no implicit rerun. Nothing
can rescore a published round, even with a previously used key.

### publishRound

```json
{"competition_id":"demo","round_number":1,"expected_scoring_revision":1}
```

The API verifies scored/completed status. The service atomically rechecks the
expected revision and publication permission and delegates publication,
advancement, elimination, leaderboard updates, and champion designation to the
team's implementations. This API defines no algorithm for those effects.
An identical repeat returns published metadata without applying any effect twice.
Stale revisions fail. Publication and rescoring must share the same atomic guard:
one may win the race, and the other must fail without partial effects.

### Safe status response and lifecycle

All four return only this projection (example):

```json
{
  "competition_id":"demo","round_id":"round-1","round_number":1,
  "state":"closed","deadline":"2026-11-01T18:00:00+00:00",
  "scoring_revision":1,"scoring_status":"queued"
}
```

No seed, allocations, group memberships, standings, unpublished results, private
engine diagnostics, or champion identity appears in these responses. The frontend
continues reading published projections directly through team-controlled rules.
The normal progression is `open -> closed -> scored -> published`; an explicit
rescore temporarily moves `scored -> closed -> scored` before publication.
Scoring statuses are `not_started`, `queued`, `running`, `failed`, and `completed`.

### Required atomicity in real services

`round_contracts.py` now defines `RoundLifecycleService`, `RoundScoringService`,
and `LifecycleMetadata`. `lifecycle_api.py` handles request validation and
delegation; `lifecycle_mocks.py` provides doubles sharing the submission mock's
lock and state. `RoundAPI` accepts the two adapters as optional constructor
arguments; missing adapters fail closed with `unavailable`.

| Operation | Required durable/atomic boundary |
| --- | --- |
| Open | Check competition and sequential-round policy; create round, config, deadline, seed, and audit once. Concurrent identical requests must resolve to the same round and seed. |
| Close | Share the state guard with submission replacement. Freeze one snapshot; prepare seeded drawing and non-submitter elimination; commit completion/visibility once, with no partially applied eliminations or groups. |
| Score | Atomically claim revision and key, invalidate stale scoring, and durably dispatch a job (for example through the team's outbox). Store private results and completed status together. Worker writes must verify the claimed revision and publication state. Failed dispatch must remain recoverable. |
| Publish | Atomically verify completed/current score and permission; guard exactly-once advancement, eliminations, leaderboard/champion effects, and published visibility against duplicate requests, concurrent rounds, and rescoring. |

An API precheck alone cannot enforce any transition. Real command services must
recheck state/time/revision atomically, including after retries. For operations
larger than one Firestore transaction, use the team's staged, durable, resumable
workflow with idempotent steps and one final visibility gate. Do not execute a
random draw, engine call, or non-idempotent external effect inside a transaction
callback that Firestore may rerun. Production authorization, audit storage,
worker recovery, snapshot integrity, and read rules belong to the real adapters.

Mocks record closure/publication counts and frozen input, and create a private
seed. No-op preparation hooks stand in for elimination/drawing/engine/publication
services; they do not implement their effects. Test-only
`complete_scoring_fixture` simulates success/failure; it is not a callable or an
automatic engine. Emulator scores therefore stay queued without a real worker.
Single-process mock locks do not establish production exactly-once guarantees.

Additional stable error reasons:

| Code | Reasons |
| --- | --- |
| `invalid-argument` | `invalid_deadline` (new round deadline is not future), `invalid_request` |
| `already-exists` | `round_conflict`, `idempotency_conflict` |
| `failed-precondition` | `deadline_not_reached`, `invalid_transition`, `scoring_incomplete`, `scoring_in_progress`, `rescore_required`, `stale_revision`, `publication_not_permitted` |
| `aborted` | `conflict` (refresh state before retrying) |
| `unavailable` | missing/temporarily unavailable adapters |
| `internal` | unexpected exceptions or unknown service failures, with private diagnostics suppressed |

The Phase 1 deprecated finalization name remains nonoperational for compatibility;
its existing `round_lifecycle_deferred` reason is retained, now with a message
directing clients to these explicit operations. No legacy path can bypass guards.

### Remaining team decisions and integration

The existing MVP contract does not specify every payload or transition boundary.
The chosen defaults are: positive round numbers resolved by the service, future
opening deadlines, no early close, score-job polling by idempotency key, explicit
revision-fenced rescoring, and revision-fenced publication. Confirm these with the
frontend and team leader before deployment. The round service, not the API, must
decide sequential rounds, competition completion, and tournament policy.

The data team must supply the real lifecycle adapter, transactions/workflows,
safe read projections, IAM/rules, audit and recovery. The engine team supplies
seeded drawing, evaluation, ranking/tiebreaking, advancement, eliminations,
leaderboard updates, and champion logic. The Auth owner supplies verified admin
claim management. Wire adapters in `runtime.py`, then run emulator/integration
tests covering durable retries, live Auth, rules, and multiple function instances.

## Setup and tests

From the repository root:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

Firebase API tests only:

```sh
python -m pytest firebase_tests -q
```

Tests need no Firebase project, account, network, or emulator. They use actual
SDK request/error types and HTTP wrappers, with trusted auth contexts in fixtures.
They cover round/competition/player isolation, strict allocation validation,
eligibility, deadline boundaries/races, resubmission/concurrency, privacy, admin
claims, service errors, and migration stubs. Lifecycle tests also cover repeated
commands, failures before commit, revision fencing, and concurrent operations.
The 27 legacy FastAPI tests are excluded from this contribution.
Live token verification, Firestore rules/transactions, and real engine behavior
need team integration tests after adapters are available.

`runtime.py` fails closed outside explicit emulator mock mode:

```text
FUNCTIONS_EMULATOR=true      (set by the team's Functions emulator)
GAME_API_BACKEND=mock
GAME_API_ADMIN_CLAIM=admin  (optional)
```

The fixture is competition `demo`, round `round-1`, active emulator UIDs `alice`
and `bob`, MVP configuration, with a deadline one hour after fixture startup.
`GAME_API_MODES` from the previous prototype is no longer used: configuration
comes from the round service. The Auth owner must create matching emulator users.
Mock state is process-local and lost on restart; it is not production storage.

To integrate, the data team supplies submission/lifecycle/scoring adapters to
`RoundAPI` in `runtime.py`.
Do not enable mocks in production. No deployment configuration, schema, rules, or credentials are included.
This contribution is not deployed to Firebase.

References: [Firebase Python callable functions](https://firebase.google.com/docs/functions/callable),
[Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions).


## Player registration: joinCompetition

Authenticated callable data:

```json
{"competition_id":"demo","display_name":"Alice"}
```

Response, including safe retries:

```json
{"competition_id":"demo","registered":true}
```

The UID and email come exclusively from Firebase's verified auth context. The
`email_verified` claim must be exactly `true`; an authenticated account without a
verified email receives `permission-denied / verified_email_required`. Client UID,
email, role and extra fields are rejected. Names are strict strings of 1–80
characters before trimming; blank names and Unicode control/format characters
are rejected. Display names are plain text: clients must render them as text.
The same identifier and 64 KiB limits apply as for other player requests.

`registration_contracts.py` defines two integration boundaries:
`RegistrationService.authorize` checks the allowlist and identity binding;
`PlayerRegistrationService.ensure_player` creates one competition member keyed
by verified UID. The data adapter must atomically recheck authorization and email
ownership at creation; an earlier grant cannot authorize a revoked registration.
Email matching/canonicalization is owned by the registration team; the mock uses
exact matching and binds one allowlisted email to one UID per competition.

Identical or changed-name retries return the same confirmation without renaming
existing players, resetting progress or reactivating eliminated members. Missing
allowlist entries and identity conflicts return `permission-denied /
registration_denied`. Unknown competitions return `not-found / not_found`;
service contention is `aborted / conflict`, unavailable adapters fail closed,
and unexpected errors return sanitized `internal` errors. No email, UID,
allowlist contents, allocation or private service diagnostics are returned.

`MockRegistrationService` implements both interfaces under the round mock's lock,
so registration enables submission in the same local state. The emulator fixture
allowlists `alice@example.test` and `bob@example.test` in `demo`; these are test
addresses, not real accounts or credentials. Real Firebase Auth and Firestore
registration remain unimplemented. Wire both services into `RoundAPI` in
`runtime.py` alongside the submission/lifecycle/scoring adapters.

## Verified tests and MVP interface differences

On 2026-10-27, local Python 3.15.1 with the existing source virtual environment
passed **250 Firebase tests, 0 failed, 0 skipped**, including **25 smoke tests**
and **52 registration tests**. Firebase Functions 0.6.0, Pydantic 2.14.1,
Firebase Admin 7.7.0, Flask 3.1.3 and pytest 9.1.1 were verified installed;
`pip check` found no broken requirements. The virtual environment was not copied.
This local Python version is test evidence, not a selected Firebase deployment
runtime. Deployment runtime/region and clean-environment installation still need
team verification. Run `python -m pytest firebase_tests -q`; run smoke tests with
`python -m pytest firebase_tests/test_local_smoke.py -q`.

All six MVP callable exports exist: `joinCompetition`, `submitAllocation`,
`openRound`, `closeRound`, `scoreRound`, `publishRound`. The root design's
`admin.openRound` notation maps to the flat `openRound` export (and similarly
for the other admin operations); claim authorization is mandatory. Auxiliary
status/inspection functions and deprecated aliases/stubs remain intact.
Submission uses `round_id`; lifecycle uses `round_number`, resolved by the
service. Snake-case payloads, explicit scoring jobs/revisions, no early close,
verified-email join policy and retry behavior need frontend/team agreement.
Allocation validation currently lives in the API and must be reconciled with
the team's engine validator. No scoring or tournament algorithm is added here.
