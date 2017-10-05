async function GameInstance(game) {
	game.logToEveryone('Welcome player!', game.player);
	await game.showNoticeToEveryone('Hello!');
	game.player[0].plays = (game.player[0].plays || 0) + 1;
}

module.exports = {
	makeInstance: GameInstance,
	numPlayers: 1,
};
