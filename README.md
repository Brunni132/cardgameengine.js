# cardgameengine.js
Simple turn-by-turn game engine for JS, allowing to quickly prototype new kind of games such as card games or RPG, and play them in a browser. It puts you in the shoes of the Game Master, who instructs what he wants from one or another player, waits for their answer and processes them. You implement the logic as in the specs, describing the game phases as a linear program and focusing only on the players and events that matters in a given phase.

Full rock-paper-scissors game sample:

```javascript
async function GameProgram(game) {
	function winnerOfRPS(p1Vote, p2Vote) {
		if (p1Vote === p2Vote) return -1;
		if (p1Vote === 'p' && p2Vote === 'r' || p1Vote === 'r' && p2Vote === 's' || p1Vote === 's' && p2Vote === 'p') return 0;
		return 1;
	}

	for (let round = 1; round <= 3; round += 1) {
		const played = await game.requestToEveryone('Your play? (r, p os s)', { validateCb: (response) => {
			if (['r', 'p', 's'].indexOf(response.text) >= 0) {
				return response.ok(response.text);
			}
			return response.reject('Unavailable choice');
		}});

		const winner = winnerOfRPS(played[0], played[1]);
		game.logToEveryone(`P1 played ${played[0]}, P2 played ${played[1]}`);
		if (winner === -1) {
			game.showNoticeToEveryone('It\'s a draw!');
		} else {
			game.showNoticeToPlayer(0, winner === 0 ? 'You won' : 'You lost');
			game.showNoticeToPlayer(1, winner === 1 ? 'You won' : 'You lost');
			break;
		}
	}
}

module.exports = {
	makeInstance: GameProgram,
	numPlayers: 2
};
```

Technically, this tool is different from an engine that would automatically build the views for your clients (such as a simple telnet server) not only in the fact that you don't need to handle the two connections separately and have stateless routines to handle their requests, but especially in that it relaxes the constraint that the state machine must be complete (i.e. handling any state for any player at any point in time). While a normal game engine revolves around a more or less explicit state machine for the game (P1 comes, what do I serve him? And P2?), cardgameengine.js runs the game on top of a VM and infers the client states from there. But because of this design, it allows the state machine to have "holes", to have moments where it isn't in any discrete state, where it's just processing in what seems synchronous code. This emulates better the behaviour of a real Game Master, whom most of the time will just focus on the current game (involving one or two players) without caring about what other players may do. People may still interrupt him and he may have something sensible to answer (if not STFU) but that's not normally part of the game, so when you are writing the rules and testing them, it would be good to forget about it wouldn't it? That's the goal of this engine: focus on what should happen, define the game phases linearily and don't worry about the rest, the server is able to handle unexpected interruptions from players gracefully (basically by telling them to come back later). This design is not however a "serious" way to build a big game for production, since in the end you will want a complete state machine.

## Usage

Run the server with `npm run server`. Then open your browser at http://localhost:3000/player/YOURNAME/GAMENAME. You may need to register users (`npm run registerUser YOURNAME`) before trying to play with them.

Games are located in the `games/` directory. `GAMENAME` is the name of a .js file located inside this directory. Modified games are reloaded automatically by the server, kicking out any user currently in it.

Note that every player plays only one game at once. Trying to participate to another game will kill the game instance in which you were participating before (another instance will be automatically created for the remaining players, and the game will restart from the beginning once the player quota is reached).

## API

API is provided through the `game` object that gets passed in parameter of the `async` function that you set as `makeInstance`. The game starts once the required `numPlayers` is reached. The API for the `game` object (type `GamePublic`) is provided below.

```javascript
// Allows for various operations within the game. Pay attention to the async methods, which you need to use with await.
class GamePublic {
	// Player data (array, indexed by playerNo -- Player 1 is 0, Player 2 is 1, etc.), freely manipulable. Persisted on the disk after change.
	get player();

	// Logging gets outputted to the player on the next page (request*, showNotice*). Use like console.log().
	logToEveryone(...message);
	logToPlayer(playerNo, ...message);

	// Requests input from the player (and blocks him until the call returns).
	// Options: validateCb=callback that receives a response where you can get .playerNo and .text, and call .ok() or .reject('reason').
	async requestToEveryone(question, options);
	async requestToPlayer(playerNo, question, options);

	// Shows a notice to the player and returns when he presses the Next button.
	// Options: timeout=period where page auto-refreshes (do not pass to have a Next button).
	async showNoticeToEveryone(text, options);
	async showNoticeToPlayer(playerNo, text, options);
}
```
