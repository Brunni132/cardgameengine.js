# cardgameengine.js
Simple card game engine for JS, allowing to quickly prototype new kind of games. It places you in the place of the Game Master and as such saves you from creating a state machine on both the client and the server by inferring it behind the scenes.

Technically, this tool is different from an engine that would automatically build the views for your clients (such as a simple telnet server) not only in the fact that you don't need to handle the two connections separately and have stateless routines to handle their requests, but especially in that it relaxes the constraint that the state machine must be complete (i.e. handling any state for any player at any point in time). It'll actually be harder to build a complete state machine with this tool, and you'll typically have "holes" if you haven't given instructions to a given player at a point, or if you are taking time processing. But on the other hand, defining and tweaking a game is of an extreme simplicity.

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

