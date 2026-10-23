"""Demo: ``python3 -m blotto`` plays a short sample game and prints the score."""
from .config import GameConfig
from .game import Game
from .player import Player


def main() -> None:
    game = Game(Player("alice"), Player("bob"), GameConfig(num_rounds=3))
    moves = [
        ([20, 20, 20, 20, 20], [35, 35, 30, 0, 0]),
        ([34, 33, 33, 0, 0], [20, 20, 20, 20, 20]),
        ([0, 0, 34, 33, 33], [25, 25, 0, 25, 25]),
    ]
    for alice_move, bob_move in moves:
        game.submit_move("alice", alice_move)
        r = game.submit_move("bob", bob_move)
        print(f"Round {r.round_number}: alice {alice_move} vs bob {bob_move}"
              f" -> {r.points_1:g} to {r.points_2:g}, winner: {r.winner or 'tie'}")
    print()
    for p in game.players:
        print(f"{p.name}: {p.points:g} points, rounds won: {p.rounds_won}")
    print(f"Winner: {game.winner.name if game.winner else 'tie'}")


if __name__ == "__main__":
    main()
