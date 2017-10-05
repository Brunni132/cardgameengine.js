async function GameInstance(game) {
	game.player[0].plays = (game.player[0].plays || 0) + 1;
	game.logToEveryone(`Welcome player! ${JSON.stringify(game.player)}`);
	await game.showNoticeToEveryone('Hello!');
}

module.exports = {
	makeInstance: GameInstance,
	numPlayers: 1,
};
