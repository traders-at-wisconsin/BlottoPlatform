import unittest

from blotto import (
    Game, GameConfig, GameError, InvalidAllocation, Player, score_round, validate_allocation,
)


class ConfigTest(unittest.TestCase):
    def test_defaults(self):
        c = GameConfig()
        self.assertEqual((c.num_battlefields, c.num_soldiers, c.num_rounds), (5, 100, 3))
        self.assertEqual(c.points, (1, 1, 1, 1, 1))

    def test_rejects_bad_settings(self):
        for kwargs in ({"num_battlefields": 0}, {"num_soldiers": -1}, {"num_rounds": 0},
                       {"num_battlefields": 2, "battlefield_points": (1, 2, 3)},
                       {"num_battlefields": 2, "battlefield_points": (1, 0)}):
            with self.assertRaises(ValueError, msg=kwargs):
                GameConfig(**kwargs)


class RulesTest(unittest.TestCase):
    def setUp(self):
        self.cfg = GameConfig(num_battlefields=3, num_soldiers=10)

    def test_validate_accepts_legal(self):
        self.assertEqual(validate_allocation(self.cfg, [5, 5, 0]), (5, 5, 0))
        self.assertEqual(validate_allocation(self.cfg, [5.0, 5, 0]), (5, 5, 0))

    def test_validate_rejects_illegal(self):
        for bad in ([5, 5], [5, 5, 1], [11, -1, 0], [3.5, 3.5, 3], "334", None,
                    [True, 9, 0], ["5", 5, 0]):
            with self.assertRaises(InvalidAllocation, msg=bad):
                validate_allocation(self.cfg, bad)

    def test_score_round(self):
        r = score_round(self.cfg, 1, "a", (6, 4, 0), "b", (3, 4, 3))
        self.assertEqual(r.field_winners, ("a", None, "b"))
        self.assertEqual((r.points_1, r.points_2), (1.5, 1.5))
        self.assertIsNone(r.winner)

    def test_weighted_battlefields(self):
        cfg = GameConfig(num_battlefields=3, num_soldiers=10, battlefield_points=(1, 1, 5))
        r = score_round(cfg, 1, "a", (5, 5, 0), "b", (0, 0, 10))
        self.assertEqual((r.points_1, r.points_2), (2, 5))
        self.assertEqual(r.winner, "b")


class GameTest(unittest.TestCase):
    def setUp(self):
        cfg = GameConfig(num_battlefields=3, num_soldiers=10, num_rounds=2)
        self.game = Game(Player("alice"), Player("bob"), cfg)

    def test_full_game_tracks_points(self):
        g = self.game
        self.assertIsNone(g.submit_move("alice", [10, 0, 0]))  # waiting for bob
        r1 = g.submit_move("bob", [0, 5, 5])
        self.assertEqual((r1.round_number, r1.winner), (1, "bob"))
        self.assertEqual(g.scores(), {"alice": 1, "bob": 2})

        g.submit_move("bob", [0, 6, 4])
        r2 = g.submit_move("alice", [0, 5, 5])
        # field 1 tie (0.5 each), field 2 bob, field 3 alice
        self.assertEqual((r2.points_1, r2.points_2), (1.5, 1.5))

        self.assertTrue(g.is_over)
        self.assertEqual(g.scores(), {"alice": 2.5, "bob": 3.5})
        self.assertEqual((g.player_1.rounds_won, g.player_2.rounds_won), (0, 1))
        self.assertEqual(g.winner.id, "bob")
        self.assertEqual(g.player_1.moves, [(10, 0, 0), (0, 5, 5)])

    def test_move_can_be_changed_before_round_ends(self):
        self.game.submit_move("alice", [10, 0, 0])
        self.game.submit_move("alice", [4, 3, 3])
        r = self.game.submit_move("bob", [3, 3, 4])
        self.assertEqual(r.allocation_1, (4, 3, 3))

    def test_state_hides_pending_moves(self):
        self.game.submit_move("alice", [7, 2, 1])
        state = self.game.to_dict()
        self.assertEqual(state["submitted"], {"alice": True, "bob": False})
        self.assertNotIn("7", str(state["rounds"]) + str(state["players"]))

    def test_tie_game_has_no_winner(self):
        for _ in range(2):
            self.game.submit_move("alice", [4, 3, 3])
            self.game.submit_move("bob", [4, 3, 3])
        self.assertTrue(self.game.is_over)
        self.assertIsNone(self.game.winner)

    def test_errors(self):
        with self.assertRaises(GameError):
            self.game.submit_move("mallory", [4, 3, 3])
        with self.assertRaises(InvalidAllocation):
            self.game.submit_move("alice", [4, 3, 4])
        with self.assertRaises(GameError):
            Game(Player("x"), Player("x"))
        for _ in range(2):
            self.game.submit_move("alice", [4, 3, 3])
            self.game.submit_move("bob", [4, 3, 3])
        with self.assertRaises(GameError):
            self.game.submit_move("alice", [4, 3, 3])


if __name__ == "__main__":
    unittest.main()
