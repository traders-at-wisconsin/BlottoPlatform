from datetime import datetime, timezone

from schema import GameConfig, Player, PlayerStatus, StandingRow

AT = datetime(2026, 10, 1, tzinfo=timezone.utc)


def test_documents_use_camel_case_and_plain_strings():
    doc = Player(display_name="Ann", status=PlayerStatus.ACTIVE, joined_at=AT).to_doc()
    assert doc == {"displayName": "Ann", "status": "active", "roundEliminated": None,
                   "furthestRound": 0, "lastResult": None, "joinedAt": AT}
    assert type(doc["status"]) is str


def test_round_trip_from_firestore_dict():
    row = StandingRow(uid="u", display_name="U", rank=1, points=2.5, wins=2, ties=1, losses=0,
                      battlefields_won=7, advanced=True)
    assert StandingRow.from_doc(row.to_doc()) == row


def test_game_config_defaults_match_the_hld():
    assert GameConfig().to_doc() == {"soldiers": 100, "battlefields": 10, "groups": 4,
                                     "advanceFraction": 0.25, "finalThreshold": 16}
