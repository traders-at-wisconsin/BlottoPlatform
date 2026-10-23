"""Blotto game engine."""
from .config import GameConfig
from .engine import InvalidAllocation, RoundResult, score_round, validate_allocation
from .game import Game, GameError
from .player import Player

__all__ = [
    "Game", "GameConfig", "GameError", "InvalidAllocation", "Player", "RoundResult",
    "score_round", "validate_allocation",
]
