"""The rules: checking a move is legal and scoring a round.

These functions have no side effects, so they are easy to test and safe to
call from anywhere.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional, Tuple

from .config import GameConfig

Allocation = Tuple[int, ...]


class InvalidAllocation(ValueError):
    """Raised when a move breaks the rules."""


def validate_allocation(config: GameConfig, allocation: Any) -> Allocation:
    """Return ``allocation`` as a tuple of ints, or raise InvalidAllocation.

    A legal move has one whole, non-negative number per battlefield, and the
    numbers add up to exactly ``num_soldiers``.
    """
    if isinstance(allocation, (str, bytes)) or not hasattr(allocation, "__iter__"):
        raise InvalidAllocation("allocation must be a list of whole numbers")
    result = []
    for x in allocation:
        # bool is a subclass of int in Python, so reject it explicitly.
        if isinstance(x, bool) or not isinstance(x, (int, float)):
            raise InvalidAllocation(f"{x!r} is not a whole number")
        if isinstance(x, float):
            if not x.is_integer():
                raise InvalidAllocation(f"{x!r} is not a whole number")
            x = int(x)
        if x < 0:
            raise InvalidAllocation("soldier counts cannot be negative")
        result.append(x)
    if len(result) != config.num_battlefields:
        raise InvalidAllocation(
            f"expected {config.num_battlefields} battlefields, got {len(result)}"
        )
    total = sum(result)
    if total != config.num_soldiers:
        raise InvalidAllocation(f"must use exactly {config.num_soldiers} soldiers, used {total}")
    return tuple(result)


@dataclass(frozen=True)
class RoundResult:
    """What happened in one round.

    ``field_winners`` holds, per battlefield, the id of the player who won it,
    or None for a tie.
    """

    round_number: int  # 1-based
    player_1: str
    player_2: str
    allocation_1: Allocation
    allocation_2: Allocation
    field_winners: Tuple[Optional[str], ...]
    points_1: float
    points_2: float

    @property
    def winner(self) -> Optional[str]:
        """Id of the player who scored more this round, or None for a tie."""
        if self.points_1 > self.points_2:
            return self.player_1
        if self.points_2 > self.points_1:
            return self.player_2
        return None

    def to_dict(self) -> dict:
        return {
            "round": self.round_number,
            "allocations": {
                self.player_1: list(self.allocation_1),
                self.player_2: list(self.allocation_2),
            },
            "field_winners": list(self.field_winners),
            "points": {self.player_1: self.points_1, self.player_2: self.points_2},
            "winner": self.winner,
        }


def score_round(
    config: GameConfig,
    round_number: int,
    player_1: str,
    allocation_1: Allocation,
    player_2: str,
    allocation_2: Allocation,
) -> RoundResult:
    """Score two legal moves against each other, one battlefield at a time."""
    points_1 = 0.0
    points_2 = 0.0
    winners = []
    for a, b, value in zip(allocation_1, allocation_2, config.points):
        if a > b:
            winners.append(player_1)
            points_1 += value
        elif b > a:
            winners.append(player_2)
            points_2 += value
        else:
            winners.append(None)
            points_1 += value / 2
            points_2 += value / 2
    return RoundResult(round_number, player_1, player_2, allocation_1, allocation_2,
                       tuple(winners), points_1, points_2)
