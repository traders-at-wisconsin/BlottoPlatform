"""Firestore document models: the contract between backend and frontend.

Every document the data layer writes is one of these models. Field names are
camelCase in Firestore; Python code uses snake_case. TypeScript types for the
frontend are generated from these models by scripts/gen_types.py, so change a
model here and regenerate rather than editing schema/firestore.ts.

Paths (built only in repo.py):

    registrations/{email}                     Registration   server only
    competitions/{cid}                        Competition
      players/{uid}                           Player
      leaderboard/current                     Leaderboard    rebuilt at publish
      rounds/{r}                              Round
        private/meta                          RoundSecrets   admins only
        submissions/{uid}                     Submission     owner, everyone after publish
        groups/{g}                            Group          everyone after publish
        results/{uid}                         PlayerResults  everyone after publish
"""

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class Doc(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True,
                              use_enum_values=True, extra="ignore")

    def to_doc(self) -> dict:
        """Firestore-ready dict: camelCase keys, enums as strings, datetimes kept."""
        return self.model_dump(by_alias=True)

    @classmethod
    def from_doc(cls, data: dict):
        return cls.model_validate(data)


class CompetitionStatus(str, Enum):
    REGISTRATION = "registration"  # players joining; no round has opened
    RUNNING = "running"
    COMPLETED = "completed"  # champion crowned


class RoundStatus(str, Enum):
    OPEN = "open"  # taking submissions until the deadline
    CLOSED = "closed"  # groups drawn, non-submitters eliminated
    SCORED = "scored"  # groups and results written, admins only
    PUBLISHED = "published"  # everything revealed


class PlayerStatus(str, Enum):
    ACTIVE = "active"
    ELIMINATED = "eliminated"
    CHAMPION = "champion"


class Outcome(str, Enum):
    WIN = "win"
    TIE = "tie"
    LOSS = "loss"


class Registration(Doc):
    email: str  # lower-cased; also the document ID
    uid: Optional[str] = None  # the one account this email belongs to, bound on first join
    created_at: datetime


class GameConfig(Doc):
    """Mirrors blotto_engine.GameConfig."""
    soldiers: int = Field(100, gt=0)
    battlefields: int = Field(10, gt=0)
    groups: int = Field(4, gt=0)
    advance_fraction: float = Field(0.25, gt=0, le=1)
    final_threshold: int = Field(16, gt=0)


class Competition(Doc):
    name: str
    config: GameConfig
    status: CompetitionStatus
    current_round: int = 0  # 0 until round 1 opens
    champion_id: Optional[str] = None
    created_at: datetime


class LastResult(Doc):
    """A player's placing in the last round they played, copied at publish."""
    round: int
    group_id: str
    rank: int
    points: float
    battlefields_won: int


class Player(Doc):
    display_name: str
    status: PlayerStatus
    round_eliminated: Optional[int] = None
    furthest_round: int = 0  # last round the player played a match in
    last_result: Optional[LastResult] = None
    joined_at: datetime


class Round(Doc):
    number: int
    status: RoundStatus
    deadline: datetime
    is_final: Optional[bool] = None  # set at close: one group means the final
    group_ids: list[str] = []
    player_count: Optional[int] = None  # submitters, set at close
    seed: Optional[int] = None  # copied from RoundSecrets at publish
    opened_at: datetime
    closed_at: Optional[datetime] = None
    scored_at: Optional[datetime] = None
    published_at: Optional[datetime] = None


class RoundSecrets(Doc):
    seed: int


class Submission(Doc):
    uid: str
    allocation: list[int]
    submitted_at: datetime


class StandingRow(Doc):
    uid: str
    display_name: str
    rank: int
    points: float
    wins: int
    ties: int
    losses: int
    battlefields_won: int
    tiebreak: Optional[str] = None  # rule that placed this row above the next
    advanced: bool


class Group(Doc):
    id: str
    round: int
    members: list[str]
    advance_count: Optional[int] = None  # set at scoring
    standings: list[StandingRow] = []  # rank order; empty until scored


class MatchSummary(Doc):
    opponent: str
    opponent_name: str
    opponent_allocation: list[int]
    battlefields_won: int
    battlefields_lost: int
    outcome: Outcome


class PlayerResults(Doc):
    uid: str
    round: int
    group_id: str
    allocation: list[int]
    rank: int
    points: float
    advanced: bool
    matches: list[MatchSummary]


class LeaderboardEntry(Doc):
    rank: int  # shared by players with identical placings
    uid: str
    display_name: str
    status: PlayerStatus
    furthest_round: int
    round_eliminated: Optional[int] = None
    group_id: Optional[str] = None  # from the furthest round
    group_rank: Optional[int] = None
    points: Optional[float] = None


class Leaderboard(Doc):
    round: int  # last published round
    updated_at: datetime
    entries: list[LeaderboardEntry]


# Models exported to TypeScript by scripts/gen_types.py.
DOCUMENT_MODELS = [Registration, Competition, Player, Leaderboard, Round, RoundSecrets,
                   Submission, Group, PlayerResults]
