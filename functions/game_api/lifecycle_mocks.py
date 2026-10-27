"""Process-local lifecycle doubles. No drawing/scoring/advancement algorithms.

Staged hooks simulate team-service preparation failures. Production adapters must
use durable jobs, transactions and idempotent effects, not these in-memory locks.
"""
import secrets
from copy import deepcopy
from dataclasses import dataclass, field

from .contracts import ServiceError
from .round_contracts import LifecycleMetadata
from .round_mocks import MockRound, MockRoundService


@dataclass
class MockWorkflow:
    seed: int = field(default_factory=lambda: secrets.randbits(128))
    frozen_allocations: dict | None = None
    closure_count: int = 0
    scoring_revision: int = 0
    scoring_status: str = "not_started"
    # Key -> request fingerprint. No engine results are generated or stored here.
    scoring_keys: dict = field(default_factory=dict)
    scoring_jobs: int = 0
    publication_count: int = 0
    publication_permitted: bool = True


class MockLifecycleEffects:
    """No-op preparation hooks for delegated team workflows; injectable in tests.

    Real elimination/drawing/publication effects must be coordinated inside the
    team's atomic/durable operation. These hooks do not execute those algorithms.
    """
    def prepare_closure(self, competition_id, round_id, frozen_allocations, seed):
        pass

    def prepare_scoring(self, competition_id, round_id, scoring_revision):
        pass

    def prepare_publication(self, competition_id, round_id, scoring_revision):
        pass


class MockLifecycleService(MockRoundService):
    def __init__(self, *args, effects=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.workflows: dict[tuple[str, str], MockWorkflow] = {
            (cid, rid): MockWorkflow()
            for cid, competition in self.competitions.items()
            for rid in competition.rounds
        }
        self.effects = effects if effects is not None else MockLifecycleEffects()

    def _round_and_workflow(self, competition_id, round_number):
        # Fixture mapping only. Production IDs are resolved by the team's adapter.
        rid = f"round-{round_number}"
        _, round_ = self._lookup(competition_id, rid)
        key = (competition_id, rid)
        if key not in self.workflows:
            self.workflows[key] = MockWorkflow()
        workflow = self.workflows[key]
        return rid, round_, workflow

    def _metadata(self, rid, number, round_, workflow):
        return LifecycleMetadata(rid, number, round_.state, round_.deadline,
                                 workflow.scoring_revision, workflow.scoring_status)

    def open_round(self, competition_id, round_number, deadline, admin_uid):
        with self.lock:
            competition = self.competitions.get(competition_id)
            if competition is None:
                raise ServiceError("not_found")
            rid = f"round-{round_number}"
            if rid in competition.rounds:
                _, round_, workflow = self._round_and_workflow(competition_id, round_number)
                if round_.deadline != deadline:
                    raise ServiceError("round_conflict")
                return self._metadata(rid, round_number, round_, workflow)
            if deadline <= self.clock():
                raise ServiceError("invalid_deadline")
            # Store seed and round together; no client may supply the seed.
            round_, workflow = MockRound(deadline), MockWorkflow()
            competition.rounds[rid] = round_
            self.workflows[(competition_id, rid)] = workflow
            return self._metadata(rid, round_number, round_, workflow)

    def lifecycle_status(self, competition_id, round_number, admin_uid):
        with self.lock:
            rid, round_, workflow = self._round_and_workflow(competition_id, round_number)
            return self._metadata(rid, round_number, round_, workflow)

    def close_round(self, competition_id, round_number, admin_uid):
        with self.lock:
            rid, round_, workflow = self._round_and_workflow(competition_id, round_number)
            if round_.state in {"closed", "scored", "published"}:
                return self._metadata(rid, round_number, round_, workflow)
            if round_.state != "open":
                raise ServiceError("invalid_transition")
            if self.clock() < round_.deadline:
                raise ServiceError("deadline_not_reached")
            staged = deepcopy(workflow)
            staged.frozen_allocations = deepcopy(round_.allocations)
            # No actual elimination or group drawing: fake the delegated boundary.
            self.effects.prepare_closure(competition_id, rid,
                                         deepcopy(staged.frozen_allocations), staged.seed)
            staged.closure_count += 1
            self.workflows[(competition_id, rid)] = staged
            round_.state = "closed"
            return self._metadata(rid, round_number, round_, staged)

    def request_scoring(self, competition_id, round_number, idempotency_key, rescore,
                        expected_scoring_revision, admin_uid):
        with self.lock:
            rid, round_, workflow = self._round_and_workflow(competition_id, round_number)
            if round_.state not in {"closed", "scored"}:
                raise ServiceError("invalid_transition")
            fingerprint = (rescore, expected_scoring_revision)
            if idempotency_key in workflow.scoring_keys:
                if workflow.scoring_keys[idempotency_key] != fingerprint:
                    raise ServiceError("idempotency_conflict")
                # Poll current sanitized status; no second engine job is created.
                return self._metadata(rid, round_number, round_, workflow)
            if workflow.scoring_status in {"queued", "running"}:
                raise ServiceError("scoring_in_progress")
            if rescore:
                if expected_scoring_revision != workflow.scoring_revision or workflow.scoring_revision == 0:
                    raise ServiceError("stale_revision")
            elif workflow.scoring_revision:
                raise ServiceError("rescore_required")
            staged = deepcopy(workflow)
            staged.scoring_revision += 1
            staged.scoring_status = "queued"
            staged.scoring_jobs += 1
            staged.scoring_keys[idempotency_key] = fingerprint
            self.effects.prepare_scoring(competition_id, rid, staged.scoring_revision)
            self.workflows[(competition_id, rid)] = staged
            round_.state = "closed"  # Invalidates previously completed scoring.
            return self._metadata(rid, round_number, round_, staged)

    def complete_scoring_fixture(self, competition_id, round_number, revision, success=True):
        """TEST ONLY: simulate a worker callback, never a callable or real engine."""
        with self.lock:
            rid, round_, workflow = self._round_and_workflow(competition_id, round_number)
            if revision != workflow.scoring_revision:
                raise ServiceError("stale_revision")
            if round_.state != "closed" or workflow.scoring_status not in {"queued", "running"}:
                raise ServiceError("invalid_transition")
            workflow.scoring_status = "completed" if success else "failed"
            round_.state = "scored" if success else "closed"

    def publish_round(self, competition_id, round_number, expected_scoring_revision, admin_uid):
        with self.lock:
            rid, round_, workflow = self._round_and_workflow(competition_id, round_number)
            if expected_scoring_revision != workflow.scoring_revision:
                raise ServiceError("stale_revision")
            if round_.state == "published":
                return self._metadata(rid, round_number, round_, workflow)
            if round_.state != "scored" or workflow.scoring_status != "completed":
                raise ServiceError("scoring_incomplete")
            if not workflow.publication_permitted:
                raise ServiceError("publication_not_permitted")
            staged = deepcopy(workflow)
            # No advancement, ranking, leaderboard, or champion algorithms here.
            self.effects.prepare_publication(competition_id, rid, staged.scoring_revision)
            staged.publication_count += 1
            self.workflows[(competition_id, rid)] = staged
            round_.state = "published"
            return self._metadata(rid, round_number, round_, staged)
