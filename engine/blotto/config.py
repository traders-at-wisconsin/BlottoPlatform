"""Game settings: how many battlefields, soldiers and rounds a game uses."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Tuple


@dataclass(frozen=True)
class GameConfig:
    """The rules for one game of Blotto.

    Each round, both players split ``num_soldiers`` across ``num_battlefields``.
    Whoever puts more soldiers on a battlefield wins its points. On a tie, the
    points are split in half. The game lasts ``num_rounds`` rounds.
    """

    num_battlefields: int = 5
    num_soldiers: int = 100
    num_rounds: int = 3
    # Points each battlefield is worth. Leave as None to make every field worth 1.
    battlefield_points: Optional[Tuple[int, ...]] = None
    points: Tuple[int, ...] = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        if self.num_battlefields < 1:
            raise ValueError("num_battlefields must be at least 1")
        if self.num_soldiers < 0:
            raise ValueError("num_soldiers cannot be negative")
        if self.num_rounds < 1:
            raise ValueError("num_rounds must be at least 1")
        points = self.battlefield_points or (1,) * self.num_battlefields
        points = tuple(int(p) for p in points)
        if len(points) != self.num_battlefields:
            raise ValueError("battlefield_points needs one entry per battlefield")
        if any(p <= 0 for p in points):
            raise ValueError("battlefield points must be positive")
        object.__setattr__(self, "points", points)

    def to_dict(self) -> dict:
        return {
            "num_battlefields": self.num_battlefields,
            "num_soldiers": self.num_soldiers,
            "num_rounds": self.num_rounds,
            "battlefield_points": list(self.points),
        }
