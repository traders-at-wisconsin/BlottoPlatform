# Blotto engine

Backend game engine for Colonel Blotto. It's pure Python (3.9+) and needs no other packages.

## Rules

- Each round, both players split **100 soldiers** across **5 battlefields** without seeing
  each other's choice.
- On each battlefield, the player with more soldiers wins its points (1 per field by
  default). On a tie, the points are split in half.
- After **3 rounds**, the player with the most total points wins.

All of these numbers can be changed in `GameConfig`.

## Code layout

| File | What it holds |
|---|---|
| `blotto/config.py` | `GameConfig`: battlefields, soldiers, rounds, and the points per battlefield |
| `blotto/player.py` | `Player`: id, name, total `points`, `rounds_won`, and the moves they made |
| `blotto/engine.py` | The rules: `validate_allocation()` checks a move, `score_round()` scores a round |
| `blotto/game.py` | `Game`: takes moves from both players, scores each round, keeps the running score, picks the winner |

## Usage

```python
from blotto import Game, GameConfig, Player

game = Game(Player("alice"), Player("bob"), GameConfig(num_rounds=3))

game.submit_move("alice", [20, 20, 20, 20, 20])        # returns None: waiting for bob
result = game.submit_move("bob", [35, 35, 30, 0, 0])   # returns the RoundResult

result.points_1, result.points_2   # 2.0, 3.0
result.winner                      # "bob"
game.scores()                      # {"alice": 2.0, "bob": 3.0}
game.is_over, game.winner          # False, None (game still in progress)
game.to_dict()                     # JSON-ready state; never shows a move before the round is scored
```

Illegal moves raise `InvalidAllocation`, for example when there are the wrong number of
battlefields, a negative or fractional count, or a total that isn't 100. Requests the game
can't accept raise `GameError`, for example an unknown player or a move after the game is
over.

## Run

From the `engine/` folder:

```bash
cd engine
```

```bash
python3 -m blotto
```

```bash
python3 -m unittest discover -s tests -v
```
