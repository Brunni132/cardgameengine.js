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

	// Starting bet
	game.logToPlayer(0, `Hello P1! You have ${p1.shared.chips} chips`);
	game.logToPlayer(1, `Hello P2! You have ${p2.shared.chips} chips`);
	if (p1.shared.chips <= 0) {
		p1.shared.chips = 150;
		game.showNoticeToPlayer(0, `You had no chips, so gave you ${p1.shared.chips} ;)`, { timeout: 3 });
	}
	if (p2.shared.chips <= 0) {
		p2.shared.chips = 150;
		game.showNoticeToPlayer(1, `You had no chips, so gave you ${p2.shared.chips} ;)`, { timeout: 3 });
	}

	p1.skillPoints = p2.skillPoints = 5;
	p1.skillCards = Object.keys(ALL_SKILL_LIST);
	p2.skillCards = Object.keys(ALL_SKILL_LIST);

	// Round loop
	while (true) {
		p1.bet = p2.bet = 0;
		p1.hand = generateRPSHand();
		p2.hand = generateRPSHand();
		const bet = (playerNo, chips) => {
			players[playerNo].shared.chips -= chips;
			players[playerNo].bet += chips;
			game.logToPlayer(playerNo, `Bet ${chips} bet`);
		};
		const fold = async function(playerNo) {
			// TODO
			return await game.showNoticeToPlayer(playerNo, 'You folded');
		};
		// All in for now (limit per room in the future)
		const maxChips = (playerNo) => players[playerNo].shared.chips;
		const randomCard = () => randomInt(0, 3);
		const ALL_SKILL_LIST = {
			'kakegurui': {
				cost: 6,
				preExecute: (mainPlayer, otherPlayer) => {},
				postExecute: (mainPlayer, otherPlayer) => {
					players.forEach((p, playerNo) => {
						bet(playerNo, maxChips(playerNo));
					});
					await game.showNoticeToEveryone('Everyone is forced all-in!');
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
	
		// Coin toss to see who starts the round
		const MINIMUM_BET = 1; // TODO based on room
		let currentPlayer = coinToss();

		// Both players bet the minimum bet
		bet(currentPlayer, MINIMUM_BET);
		bet(1 - currentPlayer, MINIMUM_BET);

		// Now generate and reveal each players hand
		game.logToPlayer(0, `Your hand: ${describeRPSHand(p1.hand)}`);
		game.logToPlayer(1, `Your hand: ${describeRPSHand(p2.hand)}`);

		const askToBet = async function(playerNo, question) {
			game.logToPlayer(playerNo, 'In-game chips:');
			game.logToPlayer(playerNo, `You=${players[playerNo].bet}, other=${players[1 - playerNo].bet}`);
			return await game.requestToPlayer(playerNo, `${question}? [1…${maxChips(playerNo)}]`, { validateCb: (response) => {
				const bet = Math.floor(parseInt(response.text));
				if (bet >= 1 && bet <= maxChips(playerNo)) {
					return response.ok(bet);
				}
				return response.reject('Cannot bet that');
			}});
		};
		const askFoldCallOrRaise = async function(playerNo) {
			game.logToPlayer(playerNo, 'In-game chips:');
			game.logToPlayer(playerNo, `You=${players[playerNo].bet}, other=${players[1 - playerNo].bet}`);
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
				bet(await askToBet(playerNo, 'Raise'));
			}
			return choice;
		};
		const askMatchOrFold = async function(playerNo) {
			const currentBet = players[playerNo].bet, matchChips = players[1 - playerNo].bet;
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
		const askUseSkill = async function(playerNo) {
			game.logToPlayer(playerNo, 'Your skills', players[playerNo].skillCards);
			const response = await game.requestToPlayer(playerNo, 'Use skill?');
			didYouMean.threshold = null;
			const skill = didYouMean(response, players[playerNo].skillCards);
			game.logToPlayer(playerNo, `Chose skill: ${skill || '(none)'}`);
			return skill;
		};
		const askPlay = async function(playerNo) {
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

		// TODO Florian -- Limit to 3 rounds (hikiwake included)
		let weHaveAWinner = false;
		while (!weHaveAWinner) {
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
			if (p1.usedSkill) skill.postExecute(p1, p2);
			if (p2.usedSkill) skill.postExecute(p2, p1);

			// Actual game…
			[p1.play, p2.play] = await Promise.all([askPlay(0), askPlay(1)]);
			game.logToEveryone(`P1 played ${p1.play}, P2 played ${p2.play}`);

			switch (winnerOfRPS(p1.play, p2.play)) {
			case 0: // P1
				p1.shared.chips += p1.bet;
				game.logToEveryone(`P1 won ${p1.bet} chips, P2 lost ${p2.bet} chips`);
				game.showNoticeToPlayer(0, 'You (P1) won!');
				game.showNoticeToPlayer(1, 'You (P2) lost!');
				weHaveAWinner = true;
				break;
			case 1: // P2
				p2.shared.chips += p2.bet;
				game.logToEveryone(`P1 lost ${p1.bet} chips, P2 won ${p2.bet} chips`);
				game.showNoticeToPlayer(0, 'You (P1) lost!');
				game.showNoticeToPlayer(1, 'You (P2) won!');
				weHaveAWinner = true;
				break;
			case -1: // Draw
				game.showNoticeToEveryone('Hikiwake!');
				break;
			}
		}
	}
}

module.exports = {
	makeInstance: GameInstance,
	numPlayers: 2,
};
