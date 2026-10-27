"""Builds the leaderboard document from player documents. No Firestore access.

Placement order:
    1. the champion
    2. furthest round played, later first
    3. still active before eliminated
    4. rank within their group in that round
    5. match points in that round
Players equal on all of these share a rank (1, 2, 2, 4).
"""

import math
from datetime import datetime

from schema import Leaderboard, LeaderboardEntry, Player, PlayerStatus


def _placing(player: Player):
    last = player.last_result if player.last_result and player.last_result.round == player.furthest_round else None
    return (
        0 if player.status == PlayerStatus.CHAMPION.value else 1,
        -player.furthest_round,
        0 if player.status == PlayerStatus.ACTIVE.value else 1,
        last.rank if last else math.inf,
        -last.points if last else 0.0,
    )


def build_leaderboard(players: dict[str, Player], round_no: int, now: datetime) -> Leaderboard:
    ordered = sorted(players.items(), key=lambda kv: (_placing(kv[1]), kv[1].display_name.lower(), kv[0]))
    entries, prev, rank = [], None, 0
    for i, (uid, p) in enumerate(ordered, start=1):
        placing = _placing(p)
        if placing != prev:
            rank, prev = i, placing
        last = p.last_result if p.last_result and p.last_result.round == p.furthest_round else None
        entries.append(LeaderboardEntry(
            rank=rank,
            uid=uid,
            display_name=p.display_name,
            status=p.status,
            furthest_round=p.furthest_round,
            round_eliminated=p.round_eliminated,
            group_id=last.group_id if last else None,
            group_rank=last.rank if last else None,
            points=last.points if last else None,
        ))
    return Leaderboard(round=round_no, updated_at=now, entries=entries)
