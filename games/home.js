async function GameInstance(game) {
	game.logToEveryone('Welcome player!');
	await game.showNoticeToEveryone('Hello!');
}

module.exports = {
	makeInstance: GameInstance,
	numPlayers: 1,
};
