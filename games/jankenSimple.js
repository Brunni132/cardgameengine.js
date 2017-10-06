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
			await game.showNoticeToEveryone('It\'s a draw!');
		} else {
			await Promise.all([
				game.showNoticeToPlayer(0, winner === 0 ? 'You won' : 'You lost'),
				game.showNoticeToPlayer(1, winner === 1 ? 'You won' : 'You lost')]);
			break;
		}
	}
}

module.exports = {
	makeInstance: GameProgram,
	numPlayers: 2
};
