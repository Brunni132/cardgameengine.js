const uuidv4 = require('uuid/v4');
const DEFAULT_DISPLAY_TIMEOUT = 3;

// A command is like a state (except that you may have more than one state running in parallel, typically one per connected client).
// Commands added last are processed last, which means that even if an user has not yet completed a given state, you can still advance in the game and stack new commands.
// Also, commands are always accompanied with the logs written for a given player. Thus, this.pendingLogs should always be outputted to the user.
class Command {
	constructor() {
		this.commandList = null;
		this.pendingLogs = null; // Can be set later, should be taken in account by commands and displayed
		this.resolveCb = null;
		this.rejectCb = null;
		this.promise = new Promise((resolve, reject) => {
			this.resolveCb = resolve;
			this.rejectCb = reject;
		});
	}
	// Used from GamePrivate only. Adds to its list of processed commands and snapshots the logs which will be returned with it.
	addToList(commandList, pendingLogs) {
		commandList.push(this);
		this.commandList = commandList;
		this.pendingLogs = pendingLogs;
	}
	// Used from GamePrivate only
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
	// Call this to resume the game execution
	resolve(result) {
		this.resolveCb(result);
		this.removeFromList();
	}
	reject(error) {
		this.rejectCb(error);
		this.removeFromList();
	}
	// You need to override this. Return true if the command can processed for the given player.
	// That doesn't mean you necessarily sent something to the user (gamePrivate.render*) but that no further command should process the current player.
	tryProcess(req, res, game, playerNo) {
		console.error('Unimplemented tryProcess');
		return false;
	}
}

// This shows a message and requires the user to validate it with a button (unlike the TimeoutCommand) before resuming the game.
class NoticeCommand extends Command {
	constructor(playerNo, text) {
		super();
		this.ackId = uuidv4();
		this.playerNo = playerNo;
		this.text = text;
	}

	tryProcess(req, res, gamePrivate, playerNo) {
		if (playerNo !== this.playerNo) return false;

		const ackId = req.param('ackId');
		if (ackId === this.ackId) {
			// ACK ID matched -> proceed
			this.resolve();
		} else {
			// Not matching ACK ID -> serve the page
			gamePrivate.renderTemplate(res, this.playerNo, 'notice', { text: this.text, ackId: this.ackId, pendingLogs: this.pendingLogs });
		}
		return true;
	}
}

// Asks the user for input, with support for an optional validation callback.
// This state is blocking until an answer is returned and validated.
class RequestCommand extends Command {
	constructor(playerNo, question, validateCb) {
		super();
		this.ackId = uuidv4();
		this.playerNo = playerNo;
		this.question = question;
		this.validateCb = validateCb;
	}

	serveQuestion(req, res, gamePrivate, optError) {
		gamePrivate.renderTemplate(res, this.playerNo, 'request', { question: this.question, error: optError, ackId: this.ackId, pendingLogs: this.pendingLogs });
	}

	tryProcess(req, res, gamePrivate, playerNo) {
		if (playerNo !== this.playerNo) return false;

		// Either the data is provided and we proceed…
		const ackId = req.param('ackId');
		if (ackId === this.ackId) {
			const responseObj = {
				text: req.param('answer'),
				playerNo: this.playerNo,
				ok: () => {
					// Note that we don't answer to the request, the client is still waiting
					this.resolve(responseObj);
				},
				reject: (reason) => {
					console.log('Rejected', reason);
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

// Shows a message to the user for a given amount of time.
// Unlike others, this state is not blocking, it resumes the execution straight to the next.
class TimeoutCommand extends Command {
	constructor(playerNo, text, timeout) {
		super();
		this.playerNo = playerNo;
		this.text = text;
		this.timeout = timeout;
	}

	tryProcess(req, res, gamePrivate, playerNo) {
		if (playerNo !== this.playerNo) return false;
		gamePrivate.renderTemplate(res, this.playerNo, 'flushLogs', { text: this.text, timeout: this.timeout, pendingLogs: this.pendingLogs });
		this.resolve();
		return true;
	}
}

// Private part of GamePublic. Internal methods.
class GamePrivate {
	constructor(gamePublic) {
		this.playerData = [];
		this.registeredPlayerIdList = ['1', '2'];
		this.playerWaiting = [];
		this.playerPendingLogs = [];
		this.commands = [];
		this.public = gamePublic;
		this.processReqTimer = [];
	}
	// Adds a command for a given player. Snapshots logs until now and clears them. The command will output them.
	addCommand(playerNo, newCommand) {
		newCommand.addToList(this.commands, this.playerPendingLogs[playerNo]);
		this.playerPendingLogs[playerNo] = '';
		return newCommand.promise;
	}
	// Appends to the pending logs for a given player.
	logToPlayer(playerNo, message) {
		this.playerPendingLogs[playerNo] += message + '\n';
	}
	// Processes an express request
	processReq(req, res) {
		const playerNo = this.translatePlayerNo(req);
		if (playerNo >= 0) {
			// This will switch to false if any command sends a response to the client
			// Else you may want to periodically call processReqForAnyPlayer
			this.playerWaiting[playerNo] = true;
			// An answer wasn't given to the player, try later
			if (!this.processReqForPlayer(req, res, playerNo) || this.playerWaiting[playerNo]) {
				this.renderTemplate(res, playerNo, 'pleaseWait', {});
			}
			return;
		}
		res.send('Unknown player');
	}
	// You can call this is you just want to see if there's anything in the command buffer for a player
	processReqForPlayer(req, res, playerNo) {
		let processed = false;
		console.log(`processing ${this.commands.length} commands`);
		this.commands.forEach(c => {
			if (!processed) {
				processed = c.tryProcess(req, res, this, playerNo);
			}
		});
		return processed;
	}
	// Renders a pug template to the user output. Required to be done at some point in a processReq.
	renderTemplate(res, playerNo, template, params) {
		res.render(template, params);
		this.playerWaiting[playerNo] = false;
	}
	// TODO
	setupPlayers(opts) {
		if (!opts || !(opts.defaults instanceof Array)) {
			throw new Error('default player options required');
		}
		return new Promise((resolve, reject) => {
			this.playerData = opts.defaults;
			this.playerData.forEach((p, i) => {
				this.playerPendingLogs[i] = '';
			});
			// Immediate response (hack)
			resolve();
		});
	}
	// Adds a NoticeCommand for the user
	showNoticeToPlayer(playerNo, text) {
		return this.addCommand(playerNo, new NoticeCommand(playerNo, text));
	}
	// Adds a TimeoutCommand for the user
	showPendingLogsToPlayer(playerNo, text, timeout) {
		return this.addCommand(playerNo, new TimeoutCommand(playerNo, text, timeout || DEFAULT_DISPLAY_TIMEOUT));
	}
	// Adds a RequestCommand for the user
	requestToPlayer(playerNo, question, validateCb) {
		return this.addCommand(playerNo, new RequestCommand(playerNo, question, validateCb));
	}
	// Returns the player index for this express request
	translatePlayerNo(req) {
		const pid = req.param('playerId');
		if (pid) {
			const found = this.registeredPlayerIdList.indexOf(pid);
			if (found >= 0) {
				return found;
			}
		}
		return -1;
	}
}

// Allows for various operations within the game. Pay attention to the async methods, which you need to use with await.
class GamePublic {
	constructor() {
		this.private = new GamePrivate(this);
	}

	// Player data, freely manipulable
	get player() {
		return this.private.playerData;
	}

	// Logging gets outputted to the player in an asynchronous manner
	logToEveryone(message) {
		for (let i = 0; i < this.player.length; i += 1) {
			this.private.logToPlayer(i, message);
		}
	}
	logToPlayer(playerNo, message) {
		return this.private.logToPlayer(playerNo, message);
	}

	// TODO
	async setupPlayers(opts) {
		return await this.private.setupPlayers(opts);
	}

	// Requests input from the player (and blocks him until the call returns)
	async requestToEveryone(question, validateCb) {
		return await Promise.all(
			this.player.map((p, playerNo) => this.private.requestToPlayer(playerNo, question, validateCb)));
	}
	async requestToPlayer(playerNo, question, validateCb) {
		return await this.private.requestToPlayer(playerNo, question, validateCb);
	}

	// Shows a notice to the player and returns when he presses the Next button.
	async showNoticeToEveryone(text) {
		return await Promise.all(
			this.player.map((p, playerNo) => this.private.showNoticeToPlayer(playerNo, text)));
	}
	async showNoticeToPlayer(playerNo, text) {
		return await this.private.showNoticeToPlayer(playerNo, text);
	}

	// Shows logs + message briefly (timeout period where page auto-refreshes)
	async showPendingLogsToEveryone(text, timeout) {
		return await Promise.all(
			this.player.map((p, playerNo) => this.private.showPendingLogsToPlayer(playerNo, text, timeout)));
	}
	async showPendingLogsToPlayer(playerNo, text, timeout) {
		return await this.private.showPendingLogsToPlayer(playerNo, text, timeout);
	}
}

// -------------------------------------------------
const express = require('express');
const app = express();
const game = new GamePublic();
const janken = require('./jankenSimple');

app.set('view engine', 'pug');

app.get('/player/:playerId', function (req, res) {
	game.private.processReq(req, res);
});

app.listen(3000, function () {
	janken(game);
});
