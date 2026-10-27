# Blotto Competition Platform — MVP Design

## Overview

The MVP runs one Colonel Blotto tournament for 150–200 club members from sign-up to champion. Each round, players submit an allocation on the website, the engine plays every pairing inside 4 groups, and the top 25% of each group advance until a final round robin decides the winner.

It runs entirely on Firebase: Authentication for sign-in, Firestore for data, Cloud Functions in Python for all server logic, and Hosting for a React web app.

**In the MVP**

- Email sign-in limited to registered players
- Submitting and resubmitting an allocation until each round's deadline
- Automatic scoring, advancement and elimination through the final
- Live round status, group standings, match-by-match results and an overall leaderboard
- An admin console to open, close, score and publish rounds

**After the MVP**

- Submitting from Python scripts with personal API keys
- Balanced (snake-seeded) groups instead of a random draw
- Automatic close when the deadline passes
- Round statistics and strategy visualizations
- Weighted battlefields and per-round rule changes

**Scale:** round 1 at 200 players is 4,900 matches, which the engine scores in under a second. The design therefore optimizes for correctness and fairness, not throughput.

## Game and tournament rules

At 150–200 players, a tournament is two group rounds plus a final. Every number below is config, so changing one needs no code change.

**Match.** Each player splits 100 soldiers across 10 battlefields as whole numbers summing to exactly 100. A battlefield goes to whoever placed more soldiers; equal counts mean nobody wins it. Winning more battlefields wins the match; equal counts are a tie.

**Group.** Every pair in a group plays once. A win scores 1 point, a tie 0.5, a loss 0. Players are ranked by:

1. Match points
2. Battlefields won across all their matches in the group
3. Head-to-head result between the tied players
4. A random draw from the round's stored seed

**Advancement.** Each group advances ceil(0.25 × group size) players. The engine uses `math.ceil`, because Python's `round(12.5)` returns 12.

**Final.** Rounds of four groups continue while more than 16 players remain. At 16 or fewer, everyone left plays one round robin and the top-ranked player wins.

| Stage | 200 players | 150 players |
| --- | --- | --- |
| Round 1 | 4 groups of 50, top 13 each advance → 52 | 2 groups of 38 and 2 of 37, top 10 each → 40 |
| Round 2 | 4 groups of 13, top 4 each → 16 | 4 groups of 10, top 3 each → 12 |
| Final | 16 players, one round robin | 12 players, one round robin |

Counts assume everyone submits; no-shows shrink the field before groups are drawn.

**Groups and no-shows.** When a round closes, everyone who submitted is shuffled into groups using the round's seed. Anyone who has not submitted by the deadline is eliminated, in every round.

**Visibility.** Submissions stay private until a round is published. Then every allocation, result and the seed become public, so players can study the field before the next round.

## Architecture

The MVP is one web app and four Firebase services, built around one rule: writes go through Python functions, reads come straight from Firestore.

1. Web app → Hosting: the browser loads the React app from Hosting's CDN.
2. Web app → Authentication: players and organizers sign in with an email link and receive a token.
3. Web app → Cloud Functions: every write (joining, submitting, admin actions) is a call to an API function carrying that token.
4. Cloud Functions → Firestore: functions perform all writes through the Admin SDK; the scoring function runs blotto_engine on each group and saves the output.
5. Firestore → Web app: browsers read Firestore directly with onSnapshot live listeners, filtered by Security Rules.

Diagram available in discord.

Three flows cover the whole product. **Submitting:** the web app calls a function, which validates with the engine and writes to Firestore. **Scoring:** an admin closes and scores the round, and the engine's results are written but stay hidden. **Reading:** once a round is published, every open browser's live listener picks up the new standings with no extra backend.

### Firebase services

| Service | Role in the design |
| --- | --- |
| [Authentication](https://firebase.google.com/docs/auth) | Passwordless email-link sign-in; issues the token every function call carries; an `admin` custom claim marks organizers |
| [Cloud Firestore](https://firebase.google.com/docs/firestore) | All tournament data; browsers read it directly with live listeners, gated by [Security Rules](https://firebase.google.com/docs/rules) |
| [Cloud Functions](https://firebase.google.com/docs/functions) (Python) | Every write: joining, submitting, and the admin round actions, including scoring with the engine |
| [Hosting](https://firebase.google.com/docs/hosting) | Serves the React + TypeScript web app from a CDN |

Two Firebase projects separate development from the live event. Cloud Functions require the pay-as-you-go Blaze plan ([pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)), but MVP traffic stays inside Firestore's free daily quota of 50,000 reads and 20,000 writes ([Firestore quotas](https://cloud.google.com/firestore/quotas)).

## Data model

This Firestore layout is the contract between the engine, backend, data layer and frontend. Each page reads one to a few documents, and anything players must not see yet is gated on the round's status.

| Path | Holds | Who can read | Written by |
| --- | --- | --- | --- |
| `registrations/{email}` | Allowlist of registered emails | Nobody (server only) | Admin import script |
| `competitions/{cid}` | Game config, status, current round number | Any signed-in player | Backend |
| `…/players/{uid}` | Display name, status (active, eliminated, champion), round eliminated | Any signed-in player | Backend |
| `…/leaderboard/current` | Every player with status and furthest round, in one document | Any signed-in player | Scoring, at publish |
| `…/rounds/{r}` | Status, deadline, RNG seed | Any signed-in player | Backend |
| `…/rounds/{r}/submissions/{uid}` | Allocation, submitted-at | Owner until publish, then everyone | Backend |
| `…/rounds/{r}/groups/{g}` | Members and ranked standings: points, W/T/L, battlefields won, advanced | Everyone after publish; admins after scoring | Scoring |
| `…/rounds/{r}/results/{uid}` | That player's matches: opponent, battlefields won and lost, outcome | Everyone after publish; admins after scoring | Scoring |

Browsers never write: Security Rules deny every client write, and functions write through the Admin SDK.

## Round lifecycle

Every round moves through four states stored in `rounds/{r}.status`, and Security Rules read that field to decide what players can see. Each transition is an admin button in the console; the backend enforces the deadline either way.

1. Open. An admin opens the round and sets its deadline. Players submit and resubmit until the deadline passes, then an admin closes the round.
2. Closed. Players who did not submit are eliminated, and groups are drawn from the seed among those who did. An admin then scores the round.
3. Scored. The engine has run and standings and results are written, but only admins can see them. If something is wrong, the admin fixes it and re-scores, which safely overwrites the previous output. Once the standings look right, an admin publishes.
4. Published. Results, every allocation and the seed are revealed, and players outside their group's top 25% are eliminated. The next round then opens at step 1, until the final; after the final round, the top-ranked player is crowned champion.

Diagram available in discord.

The review gap between Scored and Published is deliberate: if a bug or a disputed rule turns up, the admin fixes it and re-scores before anyone has seen a result.

## Game engine

The engine is a pure Python package, `blotto_engine`, with no Firebase imports and no I/O. It lives inside the `functions/` folder so it deploys with the backend, and the same code runs unchanged in tests and notebooks.

```python
@dataclass(frozen=True)
class GameConfig:
    soldiers: int = 100
    battlefields: int = 10
    groups: int = 4
    advance_fraction: float = 0.25
    final_threshold: int = 16

def validate(alloc: list[int], cfg: GameConfig) -> None: ...           # raises InvalidAllocation
def play_match(a: list[int], b: list[int], cfg: GameConfig) -> MatchResult: ...
def draw_groups(player_ids: list[str], cfg: GameConfig, seed: int) -> list[list[str]]: ...
                                                                        # one group at or below final_threshold
def run_group(allocs: dict[str, list[int]], cfg: GameConfig, seed: int) -> GroupResult: ...
def advancers(result: GroupResult, cfg: GameConfig) -> list[str]: ...   # ceil rule; the winner in the final
```

`GroupResult` holds the ranked standings, the tiebreak that decided each position, and every match, so one call gives scoring everything it writes. The engine must be deterministic: the same allocations, config and seed always produce identical output.

## Backend API

The backend is a set of Python callable functions (`https_fn.on_call`) built on `firebase_functions` and `firebase_admin`. Firebase verifies each caller's sign-in token and passes in their uid, and these functions are the only code that writes to Firestore.

| Function | Caller | What it does |
| --- | --- | --- |
| `joinCompetition` | Player | Checks the email is on the allowlist, creates the player with a display name |
| `submitAllocation` | Player | Validates with the engine, checks the round is open, the deadline has not passed and the player is active, then saves |
| `admin.openRound` | Admin | Creates the round with its deadline and a fresh seed |
| `admin.closeRound` | Admin | Freezes submissions, eliminates non-submitters, draws groups |
| `admin.scoreRound` | Admin | Runs the engine on every group, writes standings and results while still hidden |
| `admin.publishRound` | Admin | Reveals the round, eliminates non-advancers, rebuilds the leaderboard, marks the champion after the final |

**Correctness rules**

- The deadline and round status are checked with server time inside the same Firestore transaction that saves a submission, so a submission racing the close is cleanly in or out.
- Scoring is idempotent: document IDs are deterministic, so re-running it after a fix overwrites rather than duplicates.
- Admin functions require the `admin` custom claim on the caller's token.

## Data layer and leaderboard

This layer owns the schema, who can read what, and the pre-built documents every results page reads. In Firebase the Security Rules file is effectively the read API.

- **Schema as code.** Pydantic models in `functions/schema.py`, with TypeScript types generated from their JSON Schema so backend and frontend never drift.
- **Data-access module.** `repo.py` is the only place document paths appear; the backend calls functions like `save_submission` and `write_scoring_output`.
- **Security Rules.** Players read their own submission; group and result documents become readable once the round is published; admins read everything; no client writes anywhere.
- **Leaderboard at publish.** Publishing writes each group's standings, every player's status and the single leaderboard document, so each page is one or a few document reads.

Example rule for a document hidden until publish:

```
match /competitions/{cid}/rounds/{r}/results/{uid} {
  allow read: if request.auth != null && (
    request.auth.token.admin == true ||
    get(/databases/$(database)/documents/competitions/$(cid)/rounds/$(r)).data.status == "published"
  );
  allow write: if false;
}
```

## Frontend

The frontend is a React + TypeScript single-page app built with Vite, using the Firebase JavaScript SDK and served from Hosting. It is the one non-Python component, because Firestore's live listeners come from the JavaScript SDK.

| Page | What players see | Data source |
| --- | --- | --- |
| Sign in | Email-link sign-in, then a display-name prompt on first visit | Authentication, `joinCompetition` |
| Home | Current round, countdown to the deadline, my status | Live listeners on the round and my player document |
| Submit | 10 inputs with a running total that must equal 100; my saved allocation; resubmit until the deadline | `submitAllocation`, my submission document |
| Results | My matches battlefield by battlefield; my group's standings with the advance line | My results document, my group document |
| Leaderboard | Every player, status, furthest round | The leaderboard document |
| Admin console | Open, close, score and publish with confirmations; standings preview before publish | Admin functions; admin-only reads |

Pages are designed phone-first, show deadlines in the viewer's local time, and leave enforcement to the server. Each page opens its listeners once and closes them on unmount, so reads stay predictable.

## Security and integrity

The main risks are players gaining an edge rather than outside attackers, and each has one control.

| Risk | Control |
| --- | --- |
| One person, several accounts | Email-link sign-in proves ownership of the email; only allowlisted emails can join |
| Seeing allocations before the deadline | Security Rules keep submissions owner-only until the round is published |
| Late submissions | Server-time deadline check inside the save transaction |
| Tampering from the browser | No client writes; functions validate every input |
| Organizer mistakes | Score and publish are separate steps; scoring re-runs safely |
| Disputed results | Seed and every allocation public after each round; the deterministic engine reproduces any result |

Organizer accounts get the `admin` custom claim from a one-off Admin SDK script, limited to 2–3 people.

## Key design decisions

| Decision | Why |
| --- | --- |
| Reads go straight to Firestore; writes go only through functions | Validation lives in one Python codebase, and live updates need no WebSocket server |
| Python everywhere except the browser | Firestore's live listeners come from the JavaScript SDK, so the frontend is TypeScript |
| Groups drawn at close, from submitters only | No empty seats; a no-show can never distort a group |
| No submission means elimination | One rule for every round, with nothing to backfill |
| Scoring and publishing are separate admin steps | Organizers review standings before anyone sees them, and can fix and re-score |
| Seeded, deterministic engine | Any result can be reproduced from public data, which settles disputes |
| One results document per player, not per match | Round 1 writes about 200 documents instead of 4,900, and a results page is one read |
| Email-link sign-in with an allowlist | Works with any university email and limits each registered person to one account |
