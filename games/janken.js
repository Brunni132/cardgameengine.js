const inParallel = require('./helpers').inParallel;
const randomInt = require('./helpers').randomInt;

// Can be shown to the user with .desc
const generateRPSHand = (game) => {
	const result = new Array(3);
	for (let i = 0; i < 3; i += 1) {
		// TODO probability
		result[i] = ['P', 'R', 'S'][randomInt(0, 3)];
	}
	result.desc = function () {
		switch (this.length) {
			case 0: return '(empty)';
			case 1: return result[0];
			case 2: return `${result[0]} or ${result[1]}`;
			case 3: return `${result[0]}, ${result[1]} or ${result[2]}`;
		}
	};
	return result;
};

const winnerOfRPS = (p1Vote, p2Vote) => {
	if (p1Vote === 'P' && p2Vote === 'P') return -1;
	if (p1Vote === 'P' && p2Vote === 'R') return 0;
	if (p1Vote === 'P' && p2Vote === 'S') return 1;
	if (p1Vote === 'R' && p2Vote === 'P') return 1;
	if (p1Vote === 'R' && p2Vote === 'R') return -1;
	if (p1Vote === 'R' && p2Vote === 'S') return 0;
	if (p1Vote === 'S' && p2Vote === 'P') return 0;
	if (p1Vote === 'S' && p2Vote === 'R') return 1;
	if (p1Vote === 'S' && p2Vote === 'S') return -1;
	return console.error('Should not happen', p1Vote, p2Vote);
};

async function GameInstance(game) {
	const player = game.player;
	const p1 = player[0], p2 = player[1];

	game.logToPlayer(0, `Hello P1! You have ${p1.chips}`);
	game.logToPlayer(1, `Hello P2! You have ${p2.chips}`);
	if (!p1.chips) {
		p1.chips = 150;
		game.showNoticeToPlayer(0, `You had no chips, so gave you ${p1.chips} ;)`, { timeout: 3 });
	}
	if (!p2.chips) {
		p2.chips = 150;
		game.showNoticeToPlayer(1, `You had no chips, so gave you ${p2.chips} ;)`, { timeout: 3 });
	}

	while (p1.chips > 0 && p2.chips > 0) {
		const bets = [];
		const verifyBet = (response) => {
			const val = Math.floor(parseInt(response.text));
			if (val >= 1 && val <= player[response.playerNo].chips) {
				bets[response.playerNo] = val;
				return response.ok();
			}
			return response.reject('Cannot bet that');
		};

		p1.hand = generateRPSHand(game);
		p2.hand = generateRPSHand(game);

		game.logToPlayer(0, `Your hand: ${p1.hand.desc()}`);
		game.logToPlayer(1, `Your hand: ${p2.hand.desc()}`);
		await inParallel(
			game.requestToPlayer(0, `Bet? [1..${p1.chips}]`, { validateCb: verifyBet }),
			game.requestToPlayer(1, `Bet? [1..${p2.chips}]`, { validateCb: verifyBet })
		);

		let weHaveAWinner = false;
		for (let round = 1; round <= 3 && !weHaveAWinner; round += 1) {
			const plays = [];
			const verifyPlay = (response) => {
				const played = response.text.toUpperCase();
				const handIndex = player[response.playerNo].hand.indexOf(played);
				if (handIndex >= 0) {
					// Not usable anymore
					player[response.playerNo].hand.splice(handIndex, 1);
					plays[response.playerNo] = played;
					return response.ok();
				}
				return response.reject('Unavailable choice');
			};

			await inParallel(
				game.requestToPlayer(0, `Play? ${p1.hand.desc()}`, { validateCb: verifyPlay }),
				game.requestToPlayer(1, `Play? ${p2.hand.desc()}`, { validateCb: verifyPlay })
			);

			game.logToEveryone(`P1 played ${plays[0]}, P2 played ${plays[1]}`);
			switch (winnerOfRPS(plays[0], plays[1])) {
				case 0: // P1
					p1.chips += bets[0];
					p2.chips -= bets[1];
					game.logToEveryone(`P1 won ${bets[0]} chips`);
					game.logToPlayer(`P2 lost ${bets[1]} chips`);
					game.showNoticeToEveryone('P1 won!');
					weHaveAWinner = true;
					break;
				case 1: // P2
					p1.chips -= bets[0];
					p2.chips += bets[1];
					game.logToEveryone(`P1 lost ${bets[0]} chips`);
					game.logToEveryone(`P2 won ${bets[1]} chips`);
					game.showNoticeToEveryone('P2 won!');
					weHaveAWinner = true;
					break;
				case -1: // Draw
					game.showNoticeToEveryone('Hikiwake!');
					break;
			}
		}
	}

	game.logToPlayer(0, `Results ${JSON.stringify(p1)}`);
	game.logToPlayer(1, `Results ${JSON.stringify(p2)}`);
	await game.showNoticeToEveryone('Game finished');
}

module.exports = {
	makeInstance: GameInstance,
	numPlayers: 2,
};
