"""The engine output the data layer stores: what `blotto_engine.run_group` returns.

This is the proposed contract between the engine and the data layer, written
from the HLD. Until `blotto_engine` lands, `scripts/stub_engine.py` produces
these. If the engine's types differ, adapt them here, not in repo.py.
"""

from dataclasses import dataclass
from typing import Literal, Optional

# The rule that separated a player from the one ranked directly below them.
Tiebreak = Literal["points", "battlefields", "head_to_head", "draw"]


@dataclass(frozen=True)
class MatchRecord:
    player_a: str
    player_b: str
    battlefields_a: int  # battlefields won by A
    battlefields_b: int
    winner: Optional[str]  # None = tie


@dataclass(frozen=True)
class StandingRecord:
    player_id: str
    rank: int  # 1-based, unique within the group
    points: float  # win 1, tie 0.5, loss 0
    wins: int
    ties: int
    losses: int
    battlefields_won: int
    tiebreak: Optional[Tiebreak]  # None for the last-ranked player


@dataclass(frozen=True)
class GroupResult:
    standings: list[StandingRecord]  # in rank order
    matches: list[MatchRecord]  # every pair once
