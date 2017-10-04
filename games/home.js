async function GameInstance(game) {
	game.logToEveryone(`Welcome player ${JSON.stringify(game.player)}`);
	await game.showNoticeToEveryone('Hello!');
}

module.exports = {
	makeInstance: GameInstance,
	numPlayers: 1,
};
