const coinToss = require('./helpers').coinToss;
const didYouMean = require('didyoumean');
const randomInt = require('./helpers').randomInt;

const generateRPSHand = (game) => {
	// TODO probability
	return new Array(3).fill(null).map(() => ['P', 'R', 'S'][randomInt(0, 3)]);
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
	const players = game.player;
	const p1 = players[0], p2 = players[1];
	const isAllIn = (playerNo) => players[playerNo].shared.chips <= 0;
	const maxChips = (playerNo) => players[playerNo].shared.chips;

	// Starting bet
	if (!p1.shared.chips || p1.shared.chips <= 50) {
		p1.shared.chips = 150;
		game.showNoticeToPlayer(0, `You had no chips, so gave you ${p1.shared.chips} ;)`, { timeout: 3 });
	}
	if (!p2.shared.chips || p2.shared.chips <= 50) {
		p2.shared.chips = 150;
		game.showNoticeToPlayer(1, `You had no chips, so gave you ${p2.shared.chips} ;)`, { timeout: 3 });
	}

	// Round setup
	let nextPlayer = coinToss();
	p1.skillPoints = p2.skillPoints = 5;
	p1.skillCards = p2.skillCards = null;

	// Round loop
	for (let round = 1; round <= 5 && !isAllIn(0) && !isAllIn(1); round += 1) {
		game.logToEveryone(`Round ${round} start!`);
		p1.bet = p2.bet = 0;
		p1.hand = generateRPSHand();
		p2.hand = generateRPSHand();
		const bet = (playerNo, chips) => {
			players[playerNo].shared.chips -= chips;
			players[playerNo].bet += chips;
			game.logToPlayer(playerNo, `You bet ${chips} chip(s)`);
		};
		const randomCard = () => randomInt(0, 3);
		const showBets = (playerNo) => {
			game.logToPlayer(playerNo, `[In-game chips] You=${players[playerNo].bet}, other=${players[1 - playerNo].bet}`);
			game.logToPlayer(0, `Your hand: ${describeRPSHand(p1.hand)}`);
		}
		const ALL_SKILL_LIST = {
			'kakegurui': {
				cost: 6,
				preExecute: (mainPlayer, otherPlayer) => {},
				postExecute: (mainPlayer, otherPlayer) => {
					players.forEach((p, playerNo) => {
						bet(playerNo, maxChips(playerNo));
					});
					// TODO Florian -- Should be async
					game.showNoticeToEveryone('Everyone is forced all-in!');
				}
			},
			'nervesOfSteel': {
				cost: 4,
				preExecute: (mainPlayer, otherPlayer) => {
					otherPlayer.usedSkill = null;
				},
				postExecute: (mainPlayer, otherPlayer) => {}
			},
			'replaceOneCardWithPa': {
				cost: 3,
				preExecute: (mainPlayer, otherPlayer) => {},
				postExecute: (mainPlayer, otherPlayer) => {
					mainPlayer.hand[randomCard()] = 'P';
				}
			},
			'replaceOneCardWithChoki': {
				cost: 3,
				preExecute: (mainPlayer, otherPlayer) => {},
				postExecute: (mainPlayer, otherPlayer) => {
					mainPlayer.hand[randomCard()] = 'S';
				}
			},
			'replaceOneCardWithGu': {
				cost: 3,
				preExecute: (mainPlayer, otherPlayer) => {},
				postExecute: (mainPlayer, otherPlayer) => {
					mainPlayer.hand[randomCard()] = 'R';
				}
			},
		};
		// First round: they can use all cards
		if (!p1.skillCards || !p2.skillCards) {
			p1.skillCards = Object.keys(ALL_SKILL_LIST);
			p2.skillCards = Object.keys(ALL_SKILL_LIST);
		}

		// Coin toss to see who starts the round
		const MINIMUM_BET = 1; // TODO based on room
		// Alternate on a round-by-round basis
		let currentPlayer = nextPlayer;
		nextPlayer = 1 - nextPlayer;

		// Both players bet the minimum bet
		bet(currentPlayer, MINIMUM_BET);
		bet(1 - currentPlayer, MINIMUM_BET);

		// Now generate and reveal each players hand
		game.logToPlayer(0, `Your hand: ${describeRPSHand(p1.hand)}`);
		game.logToPlayer(1, `Your hand: ${describeRPSHand(p2.hand)}`);

		const askToBet = async function(playerNo, question, minimumChips) {
			showBets(playerNo);
			return await game.requestToPlayer(playerNo, `${question}? [${minimumChips}…${maxChips(playerNo)}]`, { validateCb: (response) => {
				const bet = Math.floor(parseInt(response.text));
				if (bet >= minimumChips && bet <= maxChips(playerNo)) {
					return response.ok(bet);
				}
				return response.reject('Cannot bet that');
			}});
		};
		const askFoldCallOrRaise = async function(playerNo) {
			game.logToPlayer(playerNo, `Your chips (remaining): ${players[playerNo].shared.chips}`);
			showBets(playerNo);
			const choice = await game.requestToPlayer(playerNo, '[C]all, [R]aise or [F]old', { validateCb: (response) => {
				if (!response.text) {
					game.logToPlayer(playerNo, 'Defaulted to [C]all option');
					response.text = 'c';
				}
				if (['c', 'r', 'f'].indexOf(response.text.toLowerCase()) >= 0)
					return response.ok(response.text.toLowerCase());
				return response.reject('Unsupported choice');
			}});
			if (choice === 'r') {
				bet(playerNo, await askToBet(playerNo, 'Raise', 1));
			}
			return choice;
		};
		const askMatchOrFold = async function(playerNo) {
			const currentBet = players[playerNo].bet, matchChips = players[1 - playerNo].bet;
			const willBet = Math.min(maxChips(playerNo),  matchChips - currentBet);
			game.logToPlayer(playerNo, `Your chips (remaining): ${players[playerNo].shared.chips}`);
			game.logToPlayer(playerNo, `You bet ${currentBet}, add ${willBet} chips to match?`);
			const choice = await game.requestToPlayer(playerNo, `[M]atch, [R]aise or [F]old`, { validateCb: (response) => {
				const res = response.text.toLowerCase();
				if (res === 'm') {
					bet(playerNo, willBet);
				} else if (res !== 'f' && res !== 'r') {
					return response.reject('Unsupported choice');
				}
				return response.ok(res);
			}});
			if (choice === 'r') {
				bet(playerNo, await askToBet(playerNo, 'Raise', willBet));
			}
			return choice;
		};
		const askUseSkill = async function(playerNo) {
			showBets(playerNo);
			game.logToPlayer(playerNo, 'Your skills:');
			players[playerNo].skillCards.forEach(skillName =>
				game.logToPlayer(playerNo, `  - ${skillName} (${ALL_SKILL_LIST[skillName].cost} SP)`));
			game.logToPlayer(playerNo, `Your skill points: ${players[playerNo].skillPoints}`);
			const skill = await game.requestToPlayer(playerNo, 'Use skill?', { validateCb: (response) => {
				didYouMean.threshold = null;
				const skill = didYouMean(response.text, players[playerNo].skillCards);
				if (skill && ALL_SKILL_LIST[skill].cost > players[playerNo].skillPoints) {
					return response.reject('Not enough skill points');
				}
				return response.ok(skill);
			}});
			game.logToPlayer(playerNo, `Selected skill: ${skill || '(none)'}`);
			return skill;
		};
		const askPlay = async function(playerNo) {
			showBets(playerNo);
			return await game.requestToPlayer(playerNo, `Play ${describeRPSHand(players[playerNo].hand)}`, { validateCb: (response) => {
				const played = response.text.toUpperCase();
				const handIndex = players[response.playerNo].hand.indexOf(played);
				if (handIndex >= 0) {
					// Not usable anymore
					players[response.playerNo].hand.splice(handIndex, 1);
					return response.ok(played);
				}
				return response.reject('Unavailable choice');
			}});
		};

		let hasFolded = false;
		// Until both have called
		p1.called = p2.called = false;
		while (!p1.called || !p2.called) {
			// If the first player raised, the second can either match or fold
			const hasDifference = p1.bet !== p2.bet;
			let choice = 'c';
			// We have no choice but to play if we're all-in already (we call by default)
			if (!isAllIn(currentPlayer)) {
				choice = await (hasDifference ? askMatchOrFold(currentPlayer) : askFoldCallOrRaise(currentPlayer));
			}
			if (choice === 'f') {
				// End of this round
				game.showNoticeToPlayer(currentPlayer, 'You folded!');
				game.showNoticeToPlayer(1 - currentPlayer, 'Other player folded!');
				// Distribute back tokens (FIXME?)
				players[1 - currentPlayer].shared.chips += p1.bet + p2.bet;
				hasFolded = true;
				break;
			} else if (choice === 'r') {
				players[currentPlayer].called = false;
			} else if (choice === 'c' || choice === 'm') {
				players[currentPlayer].called = true;
			}
			currentPlayer = 1 - currentPlayer;
		}

		let played = 0;
		while (!hasFolded) {
			// Choose a skill (each player)
			[p1.usedSkill, p2.usedSkill] = await Promise.all([askUseSkill(0), askUseSkill(1)]);

			// Execute pre-skills
			if (p1.usedSkill) {
				// TODO Florian -- Does a countered skill use skill points?
				const skill = ALL_SKILL_LIST[p1.usedSkill];
				skill.preExecute(p1, p2);
				p1.skillPoints -= skill.cost;
			}
			if (p2.usedSkill) {
				// TODO Florian -- Does a countered skill use skill points?
				const skill = ALL_SKILL_LIST[p2.usedSkill];
				skill.preExecute(p2, p1);
				p2.skillPoints -= skill.cost;
			}

			// Execute the actual skills (usedSkill has been set to null by skills which counter one player)
			if (p1.usedSkill) {
				ALL_SKILL_LIST[p1.usedSkill].postExecute(p1, p2);
			}
			if (p2.usedSkill) {
				ALL_SKILL_LIST[p2.usedSkill].postExecute(p2, p1);
			}

			// Actual game…
			[p1.play, p2.play] = await Promise.all([askPlay(0), askPlay(1)]);
			game.logToEveryone(`P1 played ${p1.play}, P2 played ${p2.play}`);

			const result = winnerOfRPS(p1.play, p2.play);
			if (result === 0) { // P1 won
				p1.shared.chips += p1.bet * 2;
				game.logToEveryone(`P1 won ${p1.bet} chips, P2 lost ${p2.bet} chips`);
				game.showNoticeToPlayer(0, 'You (P1) won!');
				game.showNoticeToPlayer(1, 'You (P2) lost!');
				game.logToPlayer(0, `Your chips (total): ${p1.shared.chips}`);
				game.logToPlayer(1, `Your chips (total): ${p2.shared.chips}`);
				break;
			} else if (result === 1) { // P2 won
				p2.shared.chips += p2.bet * 2;
				game.logToEveryone(`P1 lost ${p1.bet} chips, P2 won ${p2.bet} chips`);
				game.showNoticeToPlayer(0, 'You (P1) lost!');
				game.showNoticeToPlayer(1, 'You (P2) won!');
				break;
			} else { // Draw
				game.showNoticeToEveryone('Hikiwake!');
				played += 1;
				// Can only play 3 games
				if (played === 3) {
					// Give back chips
					p1.shared.chips += p1.bet;
					p2.shared.chips += p2.bet;
					break;
				}
			}
		}
		
		// End of each round
		p1.skillPoints += 1;
		p2.skillPoints += 1;
	}

	await game.showNoticeToEveryone('Game finished!');
}

module.exports = {
	makeInstance: GameInstance,
	numPlayers: 2,
};
