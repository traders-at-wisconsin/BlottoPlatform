"""Submission and lifecycle service contracts, not Firestore document schemas."""
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol


@dataclass(frozen=True)
class AllocationConfig:
    # MVP configuration. Values come from the trusted service, not client input.
    game_mode: str = "colonel-blotto"
    soldiers: int = 100
    battlefields: int = 10
    version: str = "mvp-1"


@dataclass(frozen=True)
class RoundContext:
    registered: bool
    active: bool
    state: str
    deadline: datetime  # Timezone-aware server timestamp; exclusive cutoff.
    config: AllocationConfig


@dataclass(frozen=True)
class AllocationReceipt:
    revision: int
    saved_at: datetime


@dataclass(frozen=True)
class OwnSubmissionStatus:
    submitted: bool
    revision: int | None = None
    saved_at: datetime | None = None


@dataclass(frozen=True)
class RoundInspection:
    state: str
    deadline: datetime
    config: AllocationConfig
    submitted_count: int


class RoundSubmissionService(Protocol):
    def get_context(self, competition_id: str, round_id: str, uid: str) -> RoundContext:
        """Authoritative eligibility/config/deadline; raise not_found if unknown.

        Do not expose competition metadata to unregistered callers through errors.
        """
        ...

    def replace_allocation(self, competition_id: str, round_id: str, uid: str,
                           allocation: list[int], expected_config: AllocationConfig) -> AllocationReceipt:
        """Atomically create or replace this player's one allocation for the round.

        Firestore implementation MUST re-read eligibility, round state, deadline,
        and config/version in its transaction. Use trusted fresh server time on
        every attempt; never trust client time or the API precheck. Reject at or
        after deadline, closed rounds, and changed configuration. Revalidate the
        allocation against the config used by the write. Serialize concurrent
        edits; the last committed valid write wins. Increment revision atomically.
        Transaction callbacks may retry: do not trigger scoring/awards in them.
        """
        ...

    def own_status(self, competition_id: str, round_id: str, uid: str) -> OwnSubmissionStatus:
        """Recheck registration/active status; return only the caller's metadata."""
        ...

    def inspect_round(self, competition_id: str, round_id: str, admin_uid: str) -> RoundInspection:
        """Metadata only. No allocations, unpublished results, or lifecycle writes."""
        ...


@dataclass(frozen=True)
class LifecycleMetadata:
    """Safe admin projection. Never add seeds, allocations, or scoring results."""
    round_id: str
    round_number: int
    state: Literal["open", "closed", "scored", "published"]
    deadline: datetime
    scoring_revision: int = 0
    scoring_status: Literal["not_started", "queued", "running", "failed", "completed"] = "not_started"


class RoundLifecycleService(Protocol):
    def open_round(self, competition_id: str, round_number: int, deadline: datetime,
                   admin_uid: str) -> LifecycleMetadata:
        """Atomic creation with trusted configuration and a stored random seed.

        Validate competition policy and future deadline at the write boundary.
        Retries with the same round/deadline return existing metadata without
        reopening or regenerating its seed. A changed deadline conflicts.
        Service owns round_number -> round_id mapping and sequential-round policy.
        """
        ...

    def lifecycle_status(self, competition_id: str, round_number: int,
                         admin_uid: str) -> LifecycleMetadata:
        """Read only sanitized lifecycle/scoring status, no private engine output."""
        ...

    def close_round(self, competition_id: str, round_number: int,
                    admin_uid: str) -> LifecycleMetadata:
        """After deadline, atomically freeze submissions, delegate elimination of
        non-submitters and seeded drawing, and mark closed once. No partial effects
        may become visible. A retry after closure is a no-op, even after scoring.
        Share the round guard with submission transactions. For large workflows,
        use durable resumable work/staged snapshots and one atomic visibility gate.
        Never run random drawing/external side effects in a retried transaction.
        """
        ...

    def publish_round(self, competition_id: str, round_number: int,
                      expected_scoring_revision: int, admin_uid: str) -> LifecycleMetadata:
        """Verify scored/completed/current revision and team publication policy.

        Atomically publish and delegate advancement, eliminations, leaderboard
        updates, and champion designation with a per-round exactly-once effects
        guard. Identical repeats are no-ops. Race safely against rescoring, other
        rounds, and concurrent publication; stale revisions must fail. For larger
        operations use staged idempotent work plus atomic visibility. Audit admin.
        """
        ...


class RoundScoringService(Protocol):
    def request_scoring(self, competition_id: str, round_number: int,
                        idempotency_key: str, rescore: bool,
                        expected_scoring_revision: int | None,
                        admin_uid: str) -> LifecycleMetadata:
        """Atomically claim a closed snapshot and durably dispatch to team engine.

        Store status and deduplicate keys per competition/round/operation (across
        admins). Same key/arguments polls status; changed arguments conflict.
        Explicit rescore with matching revision is allowed only before publication,
        after completed/failed work. Fence workers by scoring revision: stale job
        completion must never overwrite newer results or published data. Success
        commits scored/completed and private results together; failure remains
        closed/failed. Never expose private results or award/advance players here.
        Atomically invalidate previous score when requesting a rescore. A failed
        dispatch must be durably retryable, not an orphaned scoring flag. Audit admin.
        """
        ...
