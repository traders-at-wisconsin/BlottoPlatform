"""The Player class: who someone is and how they are doing in a game."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from .engine import Allocation


@dataclass
class Player:
    id: str
    name: str = ""
    points: float = 0.0  # total battlefield points across all rounds
    rounds_won: int = 0
    moves: List[Allocation] = field(default_factory=list)  # one entry per finished round

    def __post_init__(self) -> None:
        if not self.id:
            raise ValueError("player id cannot be empty")
        if not self.name:
            self.name = self.id

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "points": self.points,
            "rounds_won": self.rounds_won,
            "moves": [list(m) for m in self.moves],
        }
