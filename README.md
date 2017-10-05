# cardgameengine.js
Simple card game engine for JS, allowing to quickly prototype new kind of games. It places you in the head of the Game Master and as such saves you from creating a state machine on both the client and the server by inferring it behind the scenes.

Technically, this tool is different from an engine that would automatically build the views for your clients (such as a simple telnet server) not only in the fact that you don't need to handle the two connections separately and have stateless routines to handle their requests, but especially in that it relaxes the constraint that the state machine must be complete (i.e. handling any state for any player at any point in time).

While a normal game engine revolves around a more or less explicit state machine for the game (P1 comes, what do I serve him? And P2?), cardgameengine.js runs the game on top of a VM and infers the client states from there. But because of this design, it allows the state machine to have "holes", to have moments where it isn't in any discrete state, where it's just processing in what seems synchronous code. This emulates better the behaviour of a real Game Master, who may take input from all players at once in some situations, but most of the time will just focus on the current game (involving one or two players) without having anything to answer to other players. People may still interrupt him and he may have something sensible to answer depending on his social skills (if not STFU) but that's not normally part of the game, so when you are writing the rules why focus on this aspect? That's exactly the goal of this engine: focus on what should happen, don't worry about the rest, the server is able to handle unexpected interruptions from players gracefully, basically by telling them to come back later.

## Usage

Run the server with `npm run server`. Then open your browser at http://localhost:3000/player/YOURNAME/GAMENAME. You may need to register users (`npm run registerUser YOURNAME`) before trying to play with them.

Games are located in the `games/` directory. `GAMENAME` is the name of a .js file located inside this directory.

Simple way to create a rock-paper-scissors game:

```
const winnerOfRPS = (p1Vote, p2Vote) => {
	if (p1Vote === p2Vote) return -1;
	if (p1Vote === 'P' && p2Vote === 'R' ||
		p1Vote === 'R' && p2Vote === 'S' ||
		p1Vote === 'S' && p2Vote === 'P') return 0;
	return 1;
};

async function GameInstance(game) {
	await game.setupPlayers({
		defaults: [ {}, {} ]
	});

	while (true) {
		let weHaveAWinner = false;
		for (let round = 1; round <= 3 && !weHaveAWinner; round += 1) {
			const plays = [];
			await game.requestToEveryone('Your play? (r, p os s)', (response) => {
				const played = response.text.toUpperCase();
				if (['R', 'P', 'S'].indexOf(played) >= 0) {
					plays[response.playerNo] = played;
					return response.ok();
				}
				return response.reject('Unavailable choice');
			});

			const winner = winnerOfRPS(plays[0], plays[1]);
			game.logToEveryone(`P1 played ${plays[0]}, P2 played ${plays[1]}`);
			if (winner === -1) {
				game.showNoticeToEveryone('It\'s a draw!');
			} else {
				game.showNoticeToPlayer(0, winner === 0 ? 'You won' : 'You lost');
				game.showNoticeToPlayer(1, winner === 1 ? 'You won' : 'You lost');
				weHaveAWinner = true;
			}
		}
	}
}
```

