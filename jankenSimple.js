async function inParallel(...funs) {
	return await Promise.all(funs);
}

const randomInt = (min, max) => {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
};

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
			const verifyPlay = (response) => {
				const played = response.text.toUpperCase();
				if (['R', 'P', 'S'].indexOf(played) >= 0) {
					plays[response.playerNo] = played;
					return response.ok();
				}
				return response.reject('Unavailable choice');
			};

			await game.requestToEveryone('Your play? (r, p os s)', verifyPlay);

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

module.exports = GameInstance;
