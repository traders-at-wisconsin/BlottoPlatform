"""Local registration double sharing the round mock's lock and membership state."""
from .contracts import ServiceError
from .registration_contracts import RegistrationGrant


class MockRegistrationService:
    def __init__(self, rounds, allowlists):
        self.rounds = rounds
        self.allowlists = {cid: set(emails) for cid, emails in allowlists.items()}
        self.email_owners = {}
        self.players = {}

    def _authorize(self, cid, uid, email):
        if cid not in self.rounds.competitions:
            raise ServiceError("not_found")
        if (email not in self.allowlists.get(cid, set())
                or self.email_owners.get((cid, email), uid) != uid
                or ((cid, uid) in self.players and self.players[cid, uid]["email"] != email)):
            raise ServiceError("registration_denied")

    def authorize(self, competition_id, uid, email):
        with self.rounds.lock:
            self._authorize(competition_id, uid, email)
            return RegistrationGrant(competition_id, uid, email)

    def ensure_player(self, grant, display_name):
        with self.rounds.lock:
            cid, uid, email = grant.competition_id, grant.uid, grant.email
            self._authorize(cid, uid, email)
            if (cid, uid) not in self.players:
                self.players[cid, uid] = {"email": email, "display_name": display_name}
                self.email_owners[cid, email] = uid
                self.rounds.competitions[cid].players.setdefault(uid, True)
