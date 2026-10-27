"""In-process Phase 1 fixtures. Locks simulate atomicity, not Firestore storage."""
from collections.abc import Callable
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime
from threading import RLock

from .contracts import ServiceError
from .round_api import require_eligible, require_open, utc_now, validate_allocation
from .round_contracts import (AllocationConfig, AllocationReceipt, OwnSubmissionStatus,
                              RoundContext, RoundInspection)


@dataclass
class MockRound:
    deadline: datetime
    state: str = "open"
    config: AllocationConfig = field(default_factory=AllocationConfig)
    allocations: dict[str, list[int]] = field(default_factory=dict)
    receipts: dict[str, AllocationReceipt] = field(default_factory=dict)


@dataclass
class MockCompetition:
    # uid -> active. Missing uid means unregistered, False means eliminated.
    players: dict[str, bool]
    rounds: dict[str, MockRound]


class MockRoundService:
    def __init__(self, competitions: dict[str, MockCompetition],
                 clock: Callable[[], datetime] = utc_now):
        self.competitions = deepcopy(competitions)
        self.clock = clock
        self.lock = RLock()

    def _lookup(self, competition_id: str, round_id: str, uid: str | None = None):
        competition = self.competitions.get(competition_id)
        # Hide round existence from players not registered/active in competition.
        if competition is not None and uid is not None:
            if uid not in competition.players or not competition.players[uid]:
                raise ServiceError("player_ineligible")
        if competition is None or round_id not in competition.rounds:
            raise ServiceError("not_found")
        return competition, competition.rounds[round_id]

    def _context(self, competition, round_, uid):
        return RoundContext(uid in competition.players, competition.players.get(uid, False),
                            round_.state, round_.deadline, round_.config)

    def get_context(self, competition_id, round_id, uid):
        with self.lock:
            competition, round_ = self._lookup(competition_id, round_id, uid)
            return self._context(competition, round_, uid)

    def replace_allocation(self, competition_id, round_id, uid, allocation, expected_config):
        with self.lock:
            competition, round_ = self._lookup(competition_id, round_id, uid)
            context = self._context(competition, round_, uid)
            require_eligible(context)
            now = self.clock()  # Fresh time inside the atomic operation.
            require_open(context, now)
            if context.config != expected_config:
                raise ServiceError("configuration_changed")
            validate_allocation(allocation, context.config)
            previous = round_.receipts.get(uid)
            receipt = AllocationReceipt(previous.revision + 1 if previous else 1, now)
            round_.allocations[uid] = list(allocation)
            round_.receipts[uid] = receipt
            return receipt

    def own_status(self, competition_id, round_id, uid):
        with self.lock:
            _, round_ = self._lookup(competition_id, round_id, uid)
            receipt = round_.receipts.get(uid)
            return OwnSubmissionStatus(receipt is not None, receipt.revision if receipt else None,
                                       receipt.saved_at if receipt else None)

    def inspect_round(self, competition_id, round_id, admin_uid):
        with self.lock:
            _, round_ = self._lookup(competition_id, round_id)
            return RoundInspection(round_.state, round_.deadline, round_.config, len(round_.allocations))
