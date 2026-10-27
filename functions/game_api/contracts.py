"""Python interfaces, not Firestore schemas. Adapters are supplied by the team."""
from dataclasses import dataclass
from typing import Literal, Protocol

from pydantic import JsonValue


class ServiceError(Exception):
    """Adapters raise a stable reason; internal exception text is never public."""

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


@dataclass(frozen=True)
class MatchAccess:
    game_mode: str
    player_uids: tuple[str, ...]


@dataclass(frozen=True)
class SubmissionStatus:
    you_submitted: bool
    all_submitted: bool


@dataclass(frozen=True)
class PublicResult:
    # Only a released, player-safe projection, never a raw database record.
    ready: bool
    outcome: dict[str, JsonValue] | None = None


@dataclass(frozen=True)
class Inspection:
    submitted_count: int
    participant_count: int
    finalization_state: Literal["not_requested", "requested", "completed"]


@dataclass(frozen=True)
class FinalizationReceipt:
    request_id: str
    state: Literal["requested", "completed"]


class MatchService(Protocol):
    def get_access(self, match_id: str) -> MatchAccess:
        """Raise not_found for unknown matches. Assignments must stay stable."""
        ...


class SubmissionService(Protocol):
    def submit(self, match_id: str, game_mode: str, uid: str,
               payload: dict[str, JsonValue]) -> None:
        """Validate mode rules, recheck membership/mode/open state, atomically lock.

        Raise already_exists on any duplicate, invalid_submission for game-rule
        failures, failed_precondition when closed. Never replace hidden moves.
        """
        ...

    def status(self, match_id: str, game_mode: str, uid: str) -> SubmissionStatus:
        """Read consistent flags only. No private moves in this return type."""
        ...


class EvaluationService(Protocol):
    def public_result(self, match_id: str, game_mode: str) -> PublicResult:
        """Return ready=False until the team's result-release policy permits it.

        outcome must be an explicit public projection with no hidden moves.
        """
        ...

    def request_finalization(self, match_id: str, game_mode: str, admin_uid: str,
                             idempotency_key: str) -> FinalizationReceipt:
        """Persist/queue a request, not evaluate synchronously in the API.

        Recheck readiness and mode atomically. Deduplicate per match even across
        different keys/admins. Repeated keys return the same request. Auditing,
        durable dispatch, and exactly-once result/award effects belong here.
        """
        ...


class AdminService(Protocol):
    def inspect(self, match_id: str, game_mode: str) -> Inspection:
        """Return metadata only, never allocations or private service errors."""
        ...


@dataclass(frozen=True)
class Services:
    matches: MatchService
    submissions: SubmissionService
    evaluation: EvaluationService
    admin: AdminService
