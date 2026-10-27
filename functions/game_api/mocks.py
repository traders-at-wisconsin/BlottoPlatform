"""In-process test doubles only: no database, queues, scoring, or win counters."""
from copy import deepcopy
from dataclasses import dataclass, field
from threading import RLock
from uuid import uuid4

from pydantic import JsonValue

from .contracts import (FinalizationReceipt, Inspection, MatchAccess, PublicResult,
                        ServiceError, Services, SubmissionStatus)


@dataclass
class MockMatch:
    game_mode: str
    player_uids: tuple[str, ...]
    submissions_open: bool = True
    submissions: dict[str, dict[str, JsonValue]] = field(default_factory=dict)
    released_result: dict[str, JsonValue] | None = None
    finalization: FinalizationReceipt | None = None


class MockServices:
    def __init__(self, matches: dict[str, MockMatch]):
        self.matches = deepcopy(matches)
        self.lock = RLock()

    def bundle(self) -> Services:
        return Services(matches=self, submissions=self, evaluation=self, admin=self)

    def _match(self, match_id: str, game_mode: str | None = None) -> MockMatch:
        match = self.matches.get(match_id)
        if match is None:
            raise ServiceError("not_found")
        if game_mode is not None and match.game_mode != game_mode:
            raise ServiceError("failed_precondition")
        return match

    def get_access(self, match_id: str) -> MatchAccess:
        with self.lock:
            match = self._match(match_id)
            return MatchAccess(match.game_mode, match.player_uids)

    def submit(self, match_id, game_mode, uid, payload):
        with self.lock:
            match = self._match(match_id, game_mode)
            if uid not in match.player_uids:
                raise ServiceError("not_found")
            if uid in match.submissions:
                raise ServiceError("already_exists")
            if not match.submissions_open or match.finalization or match.released_result is not None:
                raise ServiceError("failed_precondition")
            # Intentionally accepts any JSON object: mode validators belong to team services.
            match.submissions[uid] = deepcopy(payload)

    def status(self, match_id, game_mode, uid):
        with self.lock:
            match = self._match(match_id, game_mode)
            if uid not in match.player_uids:
                raise ServiceError("not_found")
            return SubmissionStatus(uid in match.submissions,
                                    all(uid in match.submissions for uid in match.player_uids))

    def public_result(self, match_id, game_mode):
        with self.lock:
            match = self._match(match_id, game_mode)
            ready = (bool(match.player_uids)
                     and all(uid in match.submissions for uid in match.player_uids)
                     and match.released_result is not None)
            return PublicResult(ready, deepcopy(match.released_result) if ready else None)

    def inspect(self, match_id, game_mode):
        with self.lock:
            match = self._match(match_id, game_mode)
            state = ("completed" if match.released_result is not None else
                     "requested" if match.finalization else "not_requested")
            return Inspection(len(match.submissions), len(match.player_uids), state)

    def request_finalization(self, match_id, game_mode, admin_uid, idempotency_key):
        with self.lock:
            match = self._match(match_id, game_mode)
            if match.finalization:
                if match.released_result is not None:
                    return FinalizationReceipt(match.finalization.request_id, "completed")
                return match.finalization
            if not match.player_uids or not all(uid in match.submissions for uid in match.player_uids):
                raise ServiceError("failed_precondition")
            state = "completed" if match.released_result is not None else "requested"
            match.finalization = FinalizationReceipt(str(uuid4()), state)
            return match.finalization
