# Blotto: data layer & leaderboard (Firebase)

This is the data layer from the MVP High Level Design. It covers:
- the Firestore schema
- the data-access module the backend calls
- the Security Rules that decide what each user can read
- the leaderboard document written when a round is published

It runs no game logic. Scoring, group draws and advancement come from the engine.

| File | What it is |
| --- | --- |
| [functions/schema.py](schema.py) | Pydantic models of every Firestore document, the source of truth |
| [functions/repo.py](repo.py) | The only module that knows document paths: `create_player`, `open_round`, `save_submission`, `close_round`, `write_scoring_output`, `publish_round`, … |
| [functions/leaderboard.py](leaderboard.py) | Builds the leaderboard document; no Firestore access |
| [functions/engine_types.py](engine_types.py) | The engine output the data layer stores (`GroupResult`) |
| [functions/errors.py](errors.py) | Errors the backend maps to `HttpsError` codes |
| [firestore.rules](../firestore.rules) | Who can read what; no client writes |
| [schema/firestore.ts](../schema/firestore.ts) | TypeScript types for the frontend, generated from schema.py |
| [scripts/stub_engine.py](../scripts/stub_engine.py) | Stand-in engine with the HLD's signatures, for tests and seeding |
| [docs/SCHEMA.md](../docs/SCHEMA.md) | Paths, fields, ID rules, lifecycle, leaderboard order |

## Quick start (local, no Firebase project needed)

Run these from the repo root. You need Node 18+, Java 11+, Python 3.12 and `npm install -g firebase-tools`.

```sh
scripts/test.sh                                   # creates functions/venv on first run, runs the suite under the emulators
scripts/test.sh --seed                            # 200-player competition to a champion; browse it at http://127.0.0.1:4000
functions/venv/bin/python scripts/gen_types.py    # regenerate schema/ after changing schema.py
```

## Using it from the backend

```python
import repo
from errors import ConflictError, ForbiddenError, NotFoundError, ValidationError

db = repo.client()  # connects to the emulator when FIRESTORE_EMULATOR_HOST is set

# joinCompetition
repo.create_player(db, cid, req.auth.uid, data["displayName"], req.auth.token["email"])

# submitAllocation: status, deadline and player checks run in the save transaction
repo.save_submission(db, cid, r, req.auth.uid, data["allocation"])

# admin.closeRound
repo.close_round(db, cid, r, lambda uids, seed: blotto_engine.draw_groups(uids, cfg, seed))

# admin.scoreRound: safe to re-run
allocs = repo.get_submissions(db, cid, r)
results = {g: blotto_engine.run_group({u: allocs[u] for u in grp.members}, cfg, seed)
           for g, grp in repo.get_groups(db, cid, r).items()}
repo.write_scoring_output(db, cid, r, results, {g: blotto_engine.advancers(res, cfg) for g, res in results.items()})

# admin.publishRound
repo.publish_round(db, cid, r)
```

Map the errors to `HttpsError` codes as follows:

| Error | Code |
| --- | --- |
| `ValidationError` | `INVALID_ARGUMENT` |
| `ConflictError` | `FAILED_PRECONDITION` |
| `NotFoundError` | `NOT_FOUND` |
| `ForbiddenError` | `PERMISSION_DENIED` |

## Notes

- **Credentials.** `firebase_admin.firestore.client()` insists on Google credentials even against the emulator. `repo.client()` uses the plain Firestore client whenever `FIRESTORE_EMULATOR_HOST` is set.
- **Rules tests** send unsigned ID tokens, which the emulator accepts. That covers anonymous, player, owner and admin readers at every round status.
- **Deploying** needs a Blaze-plan project:
  1. `firebase use --add`
  2. `firebase deploy --only firestore,functions`
  3. Give organizers the claim with `auth.set_custom_user_claims(uid, {"admin": True})`.
