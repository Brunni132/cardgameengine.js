const coinToss = require('./helpers').coinToss;
const randomInt = require('./helpers').randomInt;

const generateRPSHand = (game) => {
	// TODO probability
	return new Array(3).map(() => ['P', 'R', 'S'][randomInt(0, 3)]);
};

const describeRPSHand = (hand) => {
	switch (hand.length) {
		case 0: return '(empty)';
		case 1: return hand[0];
		case 2: return `${hand[0]} or ${hand[1]}`;
		case 3: return `${hand[0]}, ${hand[1]} or ${hand[2]}`;
	}
};

const winnerOfRPS = (p1Vote, p2Vote) => {
	if (p1Vote === p2Vote) return -1;
	if (p1Vote === 'P' && p2Vote === 'R' || p1Vote === 'R' && p2Vote === 'S' || p1Vote === 'S' && p2Vote === 'P') return 0;
	return 1;
};


async function GameInstance(game) {
	// TODO refactor to have player.data for static shared data
	const players = game.player;
	const p1 = players[0], p2 = players[1];

	// Starting bet
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

	const skillPoints = [5, 5];

	while (true) {
		const totalBet = [0, 0];
		const hands = [generateRPSHand(), generateRPSHand()];
		const bet = (playerNo, chips) => {
			players[playerNo].chips -= chips;
			totalBet[playerNo] += chips;
		};
		const fold = async function(playerNo) {
			// TODO
			return await game.showNoticeToPlayer(playerNo, 'You folded');
		};

		// Coin toss to see who starts the round
		const MINIMUM_BET = 1; // TODO based on room
		let currentPlayer = coinToss();

		// Both players bet the minimum bet
		bet(currentPlayer, MINIMUM_BET);
		bet(1 - currentPlayer, MINIMUM_BET);

		// Now generate and reveal each players hand
		game.logToPlayer(0, `Your hand: ${describeRPSHand(hands[0])}`);
		game.logToPlayer(1, `Your hand: ${describeRPSHand(hands[1])}`);

		const askToBet = async function(playerNo, question) {
			return await game.requestToPlayer(playerNo, `${question}? [1…${players[playerNo].chips}]`, { validateCb: (response) => {
				const bet = Math.floor(parseInt(response.text));
				if (bet >= 1 && bet <= player[response.playerNo].chips) {
					bets[response.playerNo] = bet;
					return response.ok(bet);
				}
				return response.reject('Cannot bet that');
			}});
		};

		// Then ask the first player to raise or bet
		const askFoldCallOrRaise = async function(playerNo) {
			const choice = await game.requestToPlayer(playerNo, '[C]all, [R]aise or [F]old', { validateCb: (response) => {
				if (['c', 'r', 'f'].indexOf(response.text.toLowerCase()) >= 0)
					return response.ok(response.text.toLowerCase());
				return response.reject('Unsupported choice');
			}});
			if (choice === 'r') {
				bet(await askToBet(playerNo, 'Raise'));
			}
			return choice;
		};

		const askMatchOrFold = async function(playerNo) {
			const currentBet = totalBet[playerNo], matchChips = totalBet[1 - playerNo];
			game.logToPlayer(playerNo, `You bet ${currentBet}, add ${matchChips - currentBet} to match?`);
			const choice = await game.requestToPlayer(playerNo, `[M]atch or [F]old`, { validateCb: (response) => {
				const res = response.text.toLowerCase();
				if (res === 'm') {
					bet(playerNo, matchChips - currentBet);
				} else if (res !== 'f') {
					return response.reject('Unsupported choice');
				}
				return response.ok(res);
			}});
			return choice;
		};

		// First player can fold, call or raise
		const choice = await askFoldCallOrRaise(currentPlayer);
		if (choice === 'f') {
			// TODO End of this round
			await fold(currentPlayer);
			continue;
		}

		// If the first player raised, the second can either match or fold
		if (choice === 'r') {
			const choiceOther = await askMatchOrFold(1 - currentPlayer);
			if (choiceOther === 'f') {
				await fold(1 - currentPlayer);
				continue;
			}
		}

		// Choose a skill


	}




	// while (p1.chips > 0 && p2.chips > 0) {
	// 	const bets = [];
	// 	const verifyBet = (response) => {
	// 		const val = Math.floor(parseInt(response.text));
	// 		if (val >= 1 && val <= player[response.playerNo].chips) {
	// 			bets[response.playerNo] = val;
	// 			return response.ok();
	// 		}
	// 		return response.reject('Cannot bet that');
	// 	};

	// 	p1.hand = generateRPSHand(game);
	// 	p2.hand = generateRPSHand(game);

	// 	game.logToPlayer(0, `Your hand: ${p1.hand.desc()}`);
	// 	game.logToPlayer(1, `Your hand: ${p2.hand.desc()}`);
	// 	await inParallel(
	// 		game.requestToPlayer(0, `Bet? [1..${p1.chips}]`, { validateCb: verifyBet }),
	// 		game.requestToPlayer(1, `Bet? [1..${p2.chips}]`, { validateCb: verifyBet })
	// 	);

	// 	let weHaveAWinner = false;
	// 	for (let round = 1; round <= 3 && !weHaveAWinner; round += 1) {
	// 		const plays = [];
	// 		const verifyPlay = (response) => {
	// 			const played = response.text.toUpperCase();
	// 			const handIndex = player[response.playerNo].hand.indexOf(played);
	// 			if (handIndex >= 0) {
	// 				// Not usable anymore
	// 				player[response.playerNo].hand.splice(handIndex, 1);
	// 				plays[response.playerNo] = played;
	// 				return response.ok();
	// 			}
	// 			return response.reject('Unavailable choice');
	// 		};

	// 		await inParallel(
	// 			game.requestToPlayer(0, `Play? ${p1.hand.desc()}`, { validateCb: verifyPlay }),
	// 			game.requestToPlayer(1, `Play? ${p2.hand.desc()}`, { validateCb: verifyPlay })
	// 		);

	// 		game.logToEveryone(`P1 played ${plays[0]}, P2 played ${plays[1]}`);
	// 		switch (winnerOfRPS(plays[0], plays[1])) {
	// 			case 0: // P1
	// 				p1.chips += bets[0];
	// 				p2.chips -= bets[1];
	// 				game.logToEveryone(`P1 won ${bets[0]} chips`);
	// 				game.logToPlayer(`P2 lost ${bets[1]} chips`);
	// 				game.showNoticeToEveryone('P1 won!');
	// 				weHaveAWinner = true;
	// 				break;
	// 			case 1: // P2
	// 				p1.chips -= bets[0];
	// 				p2.chips += bets[1];
	// 				game.logToEveryone(`P1 lost ${bets[0]} chips`);
	// 				game.logToEveryone(`P2 won ${bets[1]} chips`);
	// 				game.showNoticeToEveryone('P2 won!');
	// 				weHaveAWinner = true;
	// 				break;
	// 			case -1: // Draw
	// 				game.showNoticeToEveryone('Hikiwake!');
	// 				break;
	// 		}
	// 	}
	// }

	// game.logToPlayer(0, `Results ${JSON.stringify(p1)}`);
	// game.logToPlayer(1, `Results ${JSON.stringify(p2)}`);
	// await game.showNoticeToEveryone('Game finished');
}

module.exports = {
	makeInstance: GameInstance,
	numPlayers: 2,
};
