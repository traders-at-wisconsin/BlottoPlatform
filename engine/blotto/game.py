"""The Game class: two players, several rounds, and the running score."""
from __future__ import annotations

from typing import Dict, List, Optional

from .config import GameConfig
from .engine import Allocation, RoundResult, score_round, validate_allocation
from .player import Player


class GameError(Exception):
    """A request the game can't accept (game over, unknown player, ...)."""


class Game:
    """One game of Blotto between two players.

    Both players submit a move each round, in any order. The round is scored as
    soon as the second move arrives. A player can change their move until then.
    The game ends after ``config.num_rounds`` rounds, and whoever has the most
    total points wins.
    """

    def __init__(self, player_1: Player, player_2: Player, config: Optional[GameConfig] = None):
        if player_1.id == player_2.id:
            raise GameError("the two players need different ids")
        self.config = config or GameConfig()
        self.player_1 = player_1
        self.player_2 = player_2
        self.rounds: List[RoundResult] = []
        self._pending: Dict[str, Allocation] = {}

    # ------------------------------------------------------------------ state

    @property
    def players(self) -> List[Player]:
        return [self.player_1, self.player_2]

    @property
    def current_round(self) -> int:
        """1-based number of the round being played (or the last one, once over)."""
        return min(len(self.rounds) + 1, self.config.num_rounds)

    @property
    def is_over(self) -> bool:
        return len(self.rounds) >= self.config.num_rounds

    @property
    def winner(self) -> Optional[Player]:
        """The player with the most points once the game is over, or None (ongoing or tie)."""
        if not self.is_over or self.player_1.points == self.player_2.points:
            return None
        return max(self.players, key=lambda p: p.points)

    def get_player(self, player_id: str) -> Player:
        for p in self.players:
            if p.id == player_id:
                return p
        raise GameError(f"no player with id {player_id!r} in this game")

    def has_submitted(self, player_id: str) -> bool:
        self.get_player(player_id)
        return player_id in self._pending

    def scores(self) -> Dict[str, float]:
        return {p.id: p.points for p in self.players}

    # ---------------------------------------------------------------- actions

    def submit_move(self, player_id: str, allocation) -> Optional[RoundResult]:
        """Record a player's move for the current round.

        Returns the RoundResult if this move completed the round, otherwise None.
        Raises InvalidAllocation for illegal moves and GameError for bad requests.
        """
        if self.is_over:
            raise GameError("the game is over")
        self.get_player(player_id)
        self._pending[player_id] = validate_allocation(self.config, allocation)
        if len(self._pending) < 2:
            return None
        return self._score_current_round()

    def _score_current_round(self) -> RoundResult:
        p1, p2 = self.player_1, self.player_2
        result = score_round(self.config, len(self.rounds) + 1,
                             p1.id, self._pending[p1.id], p2.id, self._pending[p2.id])
        self._pending.clear()
        self.rounds.append(result)
        p1.points += result.points_1
        p2.points += result.points_2
        p1.moves.append(result.allocation_1)
        p2.moves.append(result.allocation_2)
        if result.winner == p1.id:
            p1.rounds_won += 1
        elif result.winner == p2.id:
            p2.rounds_won += 1
        return result

    # ------------------------------------------------------------ serializing

    def to_dict(self) -> dict:
        """Game state safe to send to either player.

        Moves for the current round are never included, only whether each
        player has submitted one, so nobody can see the other's move early.
        """
        winner = self.winner
        return {
            "config": self.config.to_dict(),
            "players": [p.to_dict() for p in self.players],
            "current_round": self.current_round,
            "is_over": self.is_over,
            "winner": winner.id if winner else None,
            "submitted": {p.id: p.id in self._pending for p in self.players},
            "rounds": [r.to_dict() for r in self.rounds],
        }
