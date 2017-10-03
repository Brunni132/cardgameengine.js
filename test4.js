// function clear() {
// 	process.stdout.write('\033c');
// }

// function random(min, max) {
//   return Math.random() * (max - min) + min;
// }

// function randomInt(min, max) {
//   min = Math.ceil(min);
//   max = Math.floor(max);
//   return Math.floor(Math.random() * (max - min)) + min;
// }

// function print(...things) {
// 	things.forEach((t, i) => {
// 		if (i > 0) process.stdout.write(' ');
// 		process.stdout.write('' + t);
// 	});
// }

// function println(...things) {
// 	print(...things);
// 	process.stdout.write('\n');
// }

// function sleep(sec) {
// 	require('sleep').msleep(Math.round(sec * 1000));
// }

// function doAsyncWork() {
// 	return new Promise((resolve, reject) => {
// 		setTimeout(() => {
// 			resolve('done');
// 		}, 1000);
// 	});
// }

const DEFAULT_DISPLAY_TIMEOUT = 2;

class Command {
	constructor() {
		this.commandList = null;
		this.resolveCb = null;
		this.rejectCb = null;
		this.promise = new Promise((resolve, reject) => {
			this.resolveCb = resolve;
			this.rejectCb = reject;
		});
	}
	addToList(commandList) {
		commandList.push(this);
		this.commandList = commandList;
	}
	removeFromList() {
		if (!this.commandList) {
			return console.error('Command list null, can\'t remove myself');
		}
		const found = this.commandList.indexOf(this);
		if (found < 0) {
			return console.error('Item not found in command list');
		}
		this.commandList.splice(found, 1);
	}
	resolve(result) {
		this.resolveCb(result);
		this.removeFromList();
	}
	reject(error) {
		this.rejectCb(error);
		this.removeFromList();
	}
	tryProcess(req, res, game) {
		console.error('Unimplemented tryProcess');
		return false;
	}
}

class DisplayCommand extends Command {
	constructor(playerNo, text, timeout) {
		super();
		if (typeof timeout === 'undefined') {
			timeout = DEFAULT_DISPLAY_TIMEOUT;
		}
		this.playerNo = playerNo;
		this.text = text;
		this.timeout = timeout;
	}

	tryProcess(req, res, gamePrivate) {
		if (gamePrivate.translatePlayerId(req) !== this.playerNo) return false;

		gamePrivate.renderTemplate(res, this.playerNo, 'display', { text: this.text, timeout: this.timeout });
		this.resolve();
		return true;
	}
}

class RequestCommand extends Command {
	constructor(playerNo, question, validateCb) {
		super();
		this.playerNo = playerNo;
		this.question = question;
		this.validateCb = validateCb;
	}

	serveQuestion(req, res, gamePrivate, optError) {
		gamePrivate.renderTemplate(res, this.playerNo, 'request', { question: this.question, error: optError });
	}

	tryProcess(req, res, gamePrivate) {
		if (gamePrivate.translatePlayerId(req) !== this.playerNo) return false;

		// Either the data is provided and we proceed…
		const answer = req.param('answer');
		if (typeof answer !== 'undefined' && answer	!== null) {
			const responseObj = {
				text: answer,
				playerNo: this.playerNo,
				ok: () => {
					// Note that we don't answer to the request, the client is still waiting
					this.resolve(responseObj);
				},
				reject: (reason) => {
					this.serveQuestion(req, res, gamePrivate, reason);
				}
			}
			if (this.validateCb) {
				this.validateCb(responseObj);
			} else {
				responseObj.ok();
			}
			return true;
		}

		// … or not and we serve the form
		this.serveQuestion(req, res, gamePrivate);
		return true;
	}
}


class GamePrivate {
	constructor(gamePublic) {
		// TODO enum
		this.playerData = [];
		this.registeredPlayerIdList = ['1', '2'];
		this.playerWaiting = [];
		this.commands = [];
		this.public = gamePublic;
		this.processReqTimer = [];
	}

	addCommand(newCommand) {
		newCommand.addToList(this.commands);
		return newCommand.promise;
	}

	logToPlayer(playerNo, message) {
		this.playerData[playerNo].pendingLogs += message + '\n';
	}

	processReq(req, res) {
		const playerNo = this.translatePlayerId(req);
		if (playerNo >= 0) {
			// This will switch to false if any command sends a response to the client
			// Else you may want to periodically call processReqForAnyPlayer
			this.playerWaiting[playerNo] = true;
			if (!this.processReqForPlayer(req, res)) {
				return this.renderMessage(res, playerNo, `Nothing for you, sorry. ${this.commands.length} commands in buffer.`);
			}
			// An answer wasn't given to the player, try later
			if (this.playerWaiting[playerNo]) {
				const timer = () => {
					this.processReqForPlayer(req, res);
					if (this.playerWaiting[playerNo]) {
						this.processReqTimer[playerNo] = setTimeout(timer, 20);
					}
				};
				clearTimeout(this.processReqTimer[playerNo]);
				this.processReqTimer[playerNo] = setTimeout(timer, 20);
			}
			return;
		}
		res.send('Unknown player');
	}

	// You can call this is you just want to see if there's anything in the command buffer for a player
	processReqForPlayer(req, res) {
		let processed = false;
		console.log('processing commands', this.commands);
		this.commands.forEach(c => {
			if (!processed) {
				processed = c.tryProcess(req, res, this);
			}
		});
		return processed;
	}

	renderMessage(res, playerNo, message) {
		res.send(message);
		this.playerWaiting[playerNo] = false;
	}

	renderTemplate(res, playerNo, template, params) {
		params.pendingLogs = this.playerData[playerNo].pendingLogs;
		this.playerData[playerNo].pendingLogs = '';
		res.render(template, params);
		this.playerWaiting[playerNo] = false;
	}

	setupPlayers(opts) {
		if (!opts || !(opts.defaults instanceof Array)) {
			throw new Error('default player options required');
		}
		return new Promise((resolve, reject) => {
			this.playerData = opts.defaults;
			this.playerData.forEach(p => {
				p.pendingLogs = '';
			});
			// Immediate response (hack)
			resolve();
		});
	}

	requestToPlayer(playerNo, question, validateCb) {
		return this.addCommand(new RequestCommand(playerNo, question, validateCb));
	}

	translatePlayerId(req) {
		const pid = req.param('playerId');
		if (pid) {
			const found = this.registeredPlayerIdList.indexOf(pid);
			if (found >= 0) {
				return found;
			}
		}
		return -1;
	}

	writeToPlayer(playerNo, text, timeout) {
		this.addCommand(new DisplayCommand(playerNo, text, timeout));
	}
}

class GamePublic {
	constructor() {
		this.private = new GamePrivate(this);
	}

	get player() {
		return this.private.playerData;
	}

	logToEveryone(playerNo, message) {
		for (let i = 0; i < this.player.length; i += 1) {
			this.private.logToPlayer(i, message);
		}
	}

	logToPlayer(playerNo, message) {
		return this.private.logToPlayer(playerNo, message);
	}

	async setupPlayers(opts) {
		return await this.private.setupPlayers(opts);
	}

	async requestToEveryone(question, validateCb) {
		const sameQuestion = question;
		const result = [];
		// If not an array, use sameQuestion for everyone
		if (!(question instanceof Array)) {
			question = [];
		}
		for (let i = 0; i < this.player.length; i += 1) {
			result[i] = this.private.requestToPlayer(i, question[i] || sameQuestion, validateCb);
		}
		return await Promise.all(result);
	}

	async requestToPlayer(playerNo, question, validateCb) {
		return await this.private.requestToPlayer(playerNo, question, validateCb);
	}

	async writeToPlayer(playerNo, text, timeout) {
		return await this.private.writeToPlayer(playerNo, text, timeout);
	}
}

async function runInParallel(...funs) {
	return await Promise.all(funs);
}

// ----------------------------- ENGINE -----------------------------------
const coinToss = () => randomInt(0, 2) === 0;

const generateRPSHand = (game) => {
	const result = new Array(3);
	for (let i = 0; i < 3; i += 1) {
		// TODO probability
		result[i] = ['p', 'r', 's'][randomInt(0, 3)];
	}
	return result;
};

const random = (min, max) => Math.random() * (max - min) + min;

const randomInt = (min, max) => {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
};

async function GameInstance(game) {
	await game.setupPlayers({
		defaults: [
			{ chips: 100, deck: ['A', 'B'] },
			{ chips: 150, deck: ['A', 'C'] }
		]
	});

	if (game.player[0].chips > game.player[1].chips ||
		game.player[0].chips === game.player[1].chips && coinToss()) {
		game.currentPlayerNo = 0;
	} else {
		game.currentPlayerNo = 1;
	}

	game.logToEveryone(`Starting player: ${game.currentPlayerNo}`);
	game.logToPlayer(0, `Hello P1! You have ${JSON.stringify(game.player[0])}`);
	game.logToPlayer(1, `Hello P2! You have ${JSON.stringify(game.player[1])}`);

	// Round beginning: request the use of one or more skills
	await game.requestToEveryone('First phase - Use skill?', (response) => {
		// Has card
		if (game.player[response.playerNo].deck[response.text.toUpperCase()]) {
			return response.ok();
		} else {
			return response.reject('You do not have this card');
		}
	});

	// Bet
	await game.requestToEveryone('Bet', (response) => {
		const val = parseInt(response.text);
		const p = game.player[response.playerNo];
		if (val >= 0 && val <= p.chips) {
			p.bet = val;
			p.chips -= val;
			return response.ok();
		} else {
			return response.reject(`Not enough chips (${p.chips})`);
		}
	});

	game.player[0].hand = generateRPSHand(game);
	game.player[1].hand = generateRPSHand(game);

	await runInParallel(
		game.writeToPlayer(0, `Finished game P1`, 0),
		game.writeToPlayer(1, `Finished game P2`, 0));
}


// -------------------------------------------------
const express = require('express');
const app = express();
const game = new GamePublic();

app.set('view engine', 'pug');

app.get('/player/:playerId', function (req, res) {
	game.private.processReq(req, res);
});

app.listen(3000, function () {
	GameInstance(game);
});
