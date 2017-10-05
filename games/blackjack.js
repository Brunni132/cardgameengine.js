async function BlackjackProgram(game) {
	const player = game.player;
	const p1 = player[0], p2 = player[1];
	await game.showNoticeToEveryone('Game finished');
}

module.exports = {
	makeInstance: BlackjackProgram,
	numPlayers: 2,
};
