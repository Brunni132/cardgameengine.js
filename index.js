const uuidv4 = require('uuid/v4');
const DEFAULT_DISPLAY_TIMEOUT = 3;

class PlayerData {
	constructor(playerName) {
		this.playerName = playerName;
	}
}

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
					return false;
				},
				reject: (reason) => {
					this.serveQuestion(req, res, gamePrivate, reason);
					return true;
				}
			}
			if (this.validateCb) {
				return this.validateCb(responseObj);
			}
			return responseObj.ok();
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
	constructor(gamePublic, enginePrivate, gameModule) {
		this.enginePrivate = enginePrivate;
		this.gameModule = gameModule;
		this.playerData = [];
		this.playingPlayers = [];
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
	addPlayer(playerName) {
		if (this.findPlayerNo(playerName) >= 0) throw new Error(`Player ${playerName} already part of this game!`);
		if (!this.hasFreeSpot()) throw new Error(`This game is already full! ${playerName} cannot join.`);
		const playerNo = this.playingPlayers.length;
		this.playingPlayers.push({ playerName: playerName });
		// All joined -> start the game
		console.log(`Game has ${this.playingPlayers.length}/${this.gameModule.numPlayers}`);
		if (this.playingPlayers.length === this.gameModule.numPlayers) {
			this.gameModule.makeInstance(this.public);
			console.log('Starting game');
		}
		return playerNo;
	}
	// >= 0 if part of the game (player ID)
	findPlayerNo(playerName) {
		return this.playingPlayers.findIndex(p => p.playerName === playerName);
	}
	hasFreeSpot() {
		return this.playingPlayers.length < this.gameModule.numPlayers;
	}
	// Appends to the pending logs for a given player.
	logToPlayer(playerNo, message) {
		this.playerPendingLogs[playerNo] += message + '\n';
	}
	// Processes an express request
	processReq(playerNo, req, res) {
		console.log(`Processing request for ${playerNo}`, this.playingPlayers[playerNo]);
		// This will switch to false if any command sends a response to the client
		// Else you may want to periodically call processReqForAnyPlayer
		this.playerWaiting[playerNo] = true;
		// An answer wasn't given to the player, try later
		if (!this.processReqForPlayer(playerNo, req, res) || this.playerWaiting[playerNo]) {
			this.renderTemplate(res, playerNo, 'pleaseWait', {});
		}
	}
	// You can call this is you just want to see if there's anything in the command buffer for a player
	processReqForPlayer(playerNo, req, res) {
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
}

// Allows for various operations within the game. Pay attention to the async methods, which you need to use with await.
class GamePublic {
	constructor(enginePrivate, gameModule) {
		this.private = new GamePrivate(this, enginePrivate, gameModule);
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

class GameModule {
	constructor(enginePrivate, gameName, gameModule) {
		this.enginePrivate = enginePrivate;
		this.gameModule = gameModule;
		this.gameName = gameName;
		this.gameInstances = [];
	}

	createInstance(firstPlayerName) {
		// Debug check
		if (this.findPlayer(firstPlayerName)) throw new Error(`Player ${name} is already part of game ${this.gameName}`);
		// Create a container for this instance, with the current player
		const inst = new GamePublic(this.enginePrivate, this.gameModule);
		this.gameInstances.push(inst.private);
		return inst.private;
	}

	findFreeInstance() {
		return this.gameInstances.find(i => i.hasFreeSpot());
	}

	// Returns either null (not part of the game) or {instanceNo, playerNo}
	findPlayer(playerName) {
		for (let i = 0; i < this.gameInstances.length; i += 1) {
			const playerNo = this.gameInstances[i].findPlayerNo(playerName);
			if (playerNo >= 0) return { instanceNo: i, playerNo: playerNo };
		}
		return null;
	}

	processRequest(req, res) {
		const playerName = req.param('playerName');
		// Playing in this game? (instanceNo, playerNo within this instance)
		const playerInGame = this.findPlayer(playerName);
		console.log('Processing request', playerInGame);
		// In game -> route the request
		if (playerInGame) {
			const inst = this.gameInstances[playerInGame.instanceNo];
			inst.processReq(playerInGame.playerNo, req, res);
			return;
		}
		// Not in game, find a free instance
		let instance = this.findFreeInstance();
		if (!instance) {
			// No free instance, create one
			console.log(`Creating instance of ${this.gameName} for ${playerName}`);
			instance = this.createInstance(playerName);
		}
		console.log(`Adding ${playerName} to instance of ${this.gameName}`);
		const playerNo = instance.addPlayer(playerName);
		// Show him the waiting screen
		res.render('pleaseWait', {});
	}
}

// Front-end class
class EnginePrivate {
	constructor() {
		this.gameList = {};
		this.playerDB = {
			arnaud: {
				properties: {
					chips: 100,
				}
			},
			florian: {
				properties: {
					chips: 150,
				}
			}
		};
		Object.keys(this.playerDB).forEach(k => this.playerDB[k].currentGame = null);
	}

	// After loading the game, you need to create instances
	loadGameModuleIfNeeded(gameName) {
		if (this.gameList[gameName]) return this.gameList[gameName];
		try {
			const gameModule = require(`./games/${gameName}`);
			return this.gameList[gameName] = new GameModule(this, gameName, gameModule);
		} catch (e) {
			console.error(`Failed to load the game ${gameName}`, e);
			return null;
		}
	}

	processRequest(req, res) {
		const gameName = req.param('gameName');
		const gameModule = this.loadGameModuleIfNeeded(gameName);
		if (gameModule) {
			return gameModule.processRequest(req, res);
		}
		return res.render('error', { message: `No game ${gameName}` });
	}
}

// -------------------------------------------------
const express = require('express');
const app = express();
const engine = new EnginePrivate();

app.set('view engine', 'pug');

app.get('/player/:playerName/:gameName', function (req, res) {
	engine.processRequest(req, res);
});

app.listen(3000, function () {
});
