# Data layer: Firestore schema, access rules and leaderboard

Last updated: 2026-10-27

> This file describes the Firestore data written by the data layer of BlottoPlatform, as laid out in the MVP High Level Design.
> The models in [`functions/schema.py`](../functions/schema.py) are the source of truth. The TypeScript types in [`schema/firestore.ts`](../schema/firestore.ts) are generated from them by `scripts/gen_types.py`.
> Change this file in the same PR as any change to those models.

## Summary

The data lives under one `competitions/{cid}` document, plus an allowlist of emails stored outside it.

- **Writes:** only Cloud Functions write, and only through [`functions/repo.py`](../functions/repo.py). No other module builds a document path.
- **Reads:** browsers read Firestore directly. [`firestore.rules`](../firestore.rules) decides what each user can see, keyed on the round's `status`.
- **Page cost:** each page is one to a few document reads, because standings, results and the leaderboard are written ready to display.
- **Naming:** field names are camelCase. Times are Firestore timestamps taken from the server clock.

| Path | Model | Holds | Who can read | Written by |
| --- | --- | --- | --- | --- |
| `registrations/{email}` | `Registration` | Allowlist entry (email lower-cased), bound to one `uid` on first join | Nobody (server only) | `add_registrations` |
| `competitions/{cid}` | `Competition` | Game config, status, current round, champion | Signed-in users | `create_competition`, `open_round`, `publish_round` |
| `…/players/{uid}` | `Player` | Display name, status, round eliminated, last placing | Signed-in users | `create_player`, `close_round`, `publish_round` |
| `…/leaderboard/current` | `Leaderboard` | Every player's overall placing, in one document | Signed-in users | `publish_round` |
| `…/rounds/{r}` | `Round` | Status, deadline, groups, seed (after publish) | Signed-in users | every round step |
| `…/rounds/{r}/private/meta` | `RoundSecrets` | The seed until publish | Admins | `open_round` |
| `…/rounds/{r}/submissions/{uid}` | `Submission` | Allocation, submitted-at | The owner; everyone after publish; admins | `save_submission` |
| `…/rounds/{r}/groups/{g}` | `Group` | Members, and ranked standings after scoring | Everyone after publish; admins | `close_round`, `write_scoring_output` |
| `…/rounds/{r}/results/{uid}` | `PlayerResults` | That player's matches, battlefield counts and outcomes | Everyone after publish; admins | `write_scoring_output` |

- **Signed in** means `request.auth != null`.
- **Admin** means the custom claim `admin == true`.
- **No client writes anywhere.**

## Document IDs

All IDs are deterministic, so re-running a step overwrites documents instead of duplicating them.

| Document | ID |
| --- | --- |
| Registration | lower-cased email |
| Competition | auto ID, or chosen by the caller |
| Player, submission, results | Firebase Auth uid |
| Round | the round number as a string: `1`, `2`, … |
| Group | `A`, `B`, … in draw order (after Z: `G27`, …). The final is the round with a single group, `A` |
| Leaderboard | `current` |

## Fields

The models in `schema.py` list every field and its type. Fields that are easy to misread:

**`competitions/{cid}`**
- `config` holds `soldiers` (100), `battlefields` (10), `groups` (4), `advanceFraction` (0.25) and `finalThreshold` (16). It mirrors the engine's `GameConfig`.
- `status` moves `registration` → `running` (when round 1 opens) → `completed` (when the final is published).
- `currentRound` is 0 until round 1 opens.
- `championId` is set when the final is published.

**`players/{uid}`**
- `status` is `active`, `eliminated` or `champion`.
- `roundEliminated` is the round a player was knocked out in, by not submitting or by not advancing.
- `furthestRound` is the last round the player played matches in. It is 0 for a player who never submitted.
- `lastResult` holds `{round, groupId, rank, points, battlefieldsWon}` from that round.
- The document holds no email; emails live only in `registrations`.

**`rounds/{r}`**
- `status` moves `open` → `closed` → `scored` → `published`.
- `deadline` is enforced by the server.
- `isFinal`, `groupIds` and `playerCount` are set at close.
- `seed` stays null until publish, then is copied from `private/meta`, so the group draw can't be predicted beforehand.
- Seeds are kept under 2^53 so they survive as exact JavaScript numbers.

**`groups/{g}`**
- `members` is set at close.
- `standings` stays empty until scoring. Each row has `uid`, `displayName`, `rank`, `points` (win 1 / tie 0.5 / loss 0), `wins`, `ties`, `losses`, `battlefieldsWon`, `tiebreak` and `advanced`.
- `tiebreak` names the rule that placed a row above the next one: `points`, `battlefields`, `head_to_head` or `draw`.
- `advanceCount` is the number of players who advance.

**`results/{uid}`**
- `allocation`, `rank`, `points` and `advanced` describe the player's own round.
- `matches` has one entry per opponent: `opponent`, `opponentName`, `opponentAllocation`, `battlefieldsWon`, `battlefieldsLost` and `outcome` (`win` / `tie` / `loss`).
- Both allocations are stored, so the battlefield-by-battlefield results page is a single read. At 50 players a results document is about 9 KB.

**`leaderboard/current`**
- `round` is the last published round, and `updatedAt` is when it was published.
- `entries` lists every player in placement order. Each entry has `rank`, `uid`, `displayName`, `status`, `furthestRound`, `roundEliminated`, `groupId`, `groupRank` and `points`.
- 200 players come to about 27 KB.

## Round lifecycle

Each admin step is one function in `repo.py`, and each one checks the current status before it writes.

| Step | `repo` function | Requires | Writes |
| --- | --- | --- | --- |
| Join | `create_player(cid, uid, name, email)` | Email in `registrations` and not bound to another uid; round 1 not yet closed | `players/{uid}`. A repeated call returns the existing player |
| Open | `open_round(cid, deadline, seed=None)` | Previous round published; deadline in the future | `rounds/{r}`, `private/meta`, `currentRound` |
| Submit | `save_submission(cid, r, uid, allocation)` | Round open, server time before the deadline, player active, valid allocation, all checked in one transaction | `submissions/{uid}`. Resubmitting overwrites |
| Close | `close_round(cid, r, draw_groups)` | Round open; at least one submission | `groups/{g}` members; non-submitting active players marked eliminated; round `closed` |
| Score | `write_scoring_output(cid, r, results, advancers)` | Round `closed` or `scored` | `groups/{g}` standings, `results/{uid}`; round `scored`. Can be re-run |
| Publish | `publish_round(cid, r)` | Round `scored` | Player statuses, champion after the final, `leaderboard/current`, round `published` with its seed |

- **Engine inputs.** `draw_groups(uids, seed)`, `results` (group ID → `GroupResult`) and `advancers` (group ID → uids) come from the engine. Their contract is in [`functions/engine_types.py`](../functions/engine_types.py).
- **Commit sizes.**
  - Score and publish each commit in a single atomic batch while they stay under Firestore's 500 writes per batch. Round 1 at 200 players is about 205 writes.
  - Above that limit, the derived documents are written first, and the status change that reveals them comes last.
- **Stale reads.** The round's status update carries a `lastUpdateTime` precondition. A concurrent change to the round fails the commit instead of overwriting it.

## Leaderboard order

The leaderboard is built in [`functions/leaderboard.py`](../functions/leaderboard.py) as a pure function, from player documents.

1. The champion.
2. Furthest round played, latest first.
3. Players still active before eliminated players.
4. Rank within their group in that round.
5. Match points in that round.

Players equal on all five share a rank (1, 2, 2, 4). Players who never submitted come last, with `furthestRound` 0.

## Still to agree with the team

| Question | Current choice |
| --- | --- |
| The engine's `GroupResult` shape | Proposed in `engine_types.py`; the stub engine in `scripts/stub_engine.py` implements it |
| Seed visibility before publish | Hidden in `rounds/{r}/private/meta`; the HLD shows it on the round document |
| Leaderboard order | As described above. The HLD only says "every player, status, furthest round" |
| Competition status values | `registration` / `running` / `completed` |
| When joining closes | When round 1 closes |
