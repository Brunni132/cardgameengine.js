async function GameInstance(game) {
	game.logToEveryone('Here is your player data:');
	game.logToEveryone(game.player[0]);
	await game.showNoticeToEveryone(`Welcome ${game.player[0].name}!`);
	// Increment number of plays
	game.player[0].static.plays = (game.player[0].static.plays || 0) + 1;
}

module.exports = {
	makeInstance: GameInstance,
	numPlayers: 1,
};
