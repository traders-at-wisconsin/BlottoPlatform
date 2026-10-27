"""Stand-in for blotto_engine with the HLD's signatures, for tests and seeding.

Not the real engine: head-to-head only covers two-way ties, and nothing here is
tuned. Replace with `import blotto_engine` once it lands.
"""

import math
import random
from itertools import combinations

from engine_types import GroupResult, MatchRecord, StandingRecord
from schema import GameConfig


def draw_groups(player_ids, cfg: GameConfig, seed):
    ids = sorted(player_ids)
    random.Random(seed).shuffle(ids)
    if len(ids) <= cfg.final_threshold:
        return [ids]
    return [ids[i::cfg.groups] for i in range(cfg.groups)]


def play_match(a, b):
    won_a = sum(x > y for x, y in zip(a, b))
    won_b = sum(y > x for x, y in zip(a, b))
    return won_a, won_b


def run_group(allocs, cfg: GameConfig, seed):
    ids = sorted(allocs)
    stats = {pid: {"points": 0.0, "wins": 0, "ties": 0, "losses": 0, "bf": 0} for pid in ids}
    matches, h2h = [], {}
    for a, b in combinations(ids, 2):
        won_a, won_b = play_match(allocs[a], allocs[b])
        winner = a if won_a > won_b else b if won_b > won_a else None
        matches.append(MatchRecord(a, b, won_a, won_b, winner))
        h2h[(a, b)], h2h[(b, a)] = winner, winner
        stats[a]["bf"] += won_a
        stats[b]["bf"] += won_b
        for pid in (a, b):
            s = stats[pid]
            if winner is None:
                s["points"] += 0.5
                s["ties"] += 1
            elif winner == pid:
                s["points"] += 1
                s["wins"] += 1
            else:
                s["losses"] += 1

    draw = {pid: random.Random(f"{seed}:{pid}").random() for pid in ids}
    ordered = sorted(ids, key=lambda p: (-stats[p]["points"], -stats[p]["bf"], draw[p]))
    # Two-way head-to-head: swap a level pair when the lower one won their match.
    for i in range(len(ordered) - 1):
        a, b = ordered[i], ordered[i + 1]
        level = (stats[a]["points"], stats[a]["bf"]) == (stats[b]["points"], stats[b]["bf"])
        if level and h2h[(a, b)] == b:
            ordered[i], ordered[i + 1] = b, a

    def tiebreak(i):
        if i == len(ordered) - 1:
            return None
        a, b = stats[ordered[i]], stats[ordered[i + 1]]
        if a["points"] != b["points"]:
            return "points"
        if a["bf"] != b["bf"]:
            return "battlefields"
        return "head_to_head" if h2h[(ordered[i], ordered[i + 1])] else "draw"

    standings = [StandingRecord(pid, i + 1, stats[pid]["points"], stats[pid]["wins"], stats[pid]["ties"],
                                stats[pid]["losses"], stats[pid]["bf"], tiebreak(i))
                 for i, pid in enumerate(ordered)]
    return GroupResult(standings, matches)


def advancers(result: GroupResult, cfg: GameConfig, is_final=False):
    if is_final:
        return [result.standings[0].player_id]
    k = math.ceil(cfg.advance_fraction * len(result.standings))
    return [s.player_id for s in result.standings[:k]]


def random_allocation(rng, cfg: GameConfig):
    cuts = sorted(rng.randint(0, cfg.soldiers) for _ in range(cfg.battlefields - 1))
    edges = [0, *cuts, cfg.soldiers]
    return [edges[i + 1] - edges[i] for i in range(cfg.battlefields)]
