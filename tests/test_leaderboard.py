from datetime import datetime, timezone

from leaderboard import build_leaderboard
from schema import LastResult, Player

AT = datetime(2026, 10, 1, tzinfo=timezone.utc)


def player(name, status, furthest, rank=None, points=0.0, eliminated=None):
    last = LastResult(round=furthest, group_id="A", rank=rank, points=points, battlefields_won=0) if rank else None
    return Player(display_name=name, status=status, furthest_round=furthest, last_result=last,
                  round_eliminated=eliminated, joined_at=AT)


def test_order_champion_then_furthest_round_then_active_then_group_rank():
    board = build_leaderboard({
        "noshow": player("Noshow", "eliminated", 0, eliminated=1),
        "r1_out": player("Out", "eliminated", 1, rank=3, points=1, eliminated=1),
        "r2_active": player("Active", "active", 2, rank=2, points=2),
        "r2_out": player("Gone", "eliminated", 2, rank=1, points=3, eliminated=2),
        "champ": player("Champ", "champion", 3, rank=1, points=3),
    }, 3, AT)
    assert [e.uid for e in board.entries] == ["champ", "r2_active", "r2_out", "r1_out", "noshow"]
    assert [e.rank for e in board.entries] == [1, 2, 3, 4, 5]
    assert board.entries[-1].group_id is None


def test_equal_placings_share_a_rank():
    board = build_leaderboard({
        "a": player("A", "active", 1, rank=1, points=2),
        "b": player("B", "active", 1, rank=1, points=2),
        "c": player("C", "active", 1, rank=2, points=1),
    }, 1, AT)
    assert [(e.uid, e.rank) for e in board.entries] == [("a", 1), ("b", 1), ("c", 3)]
