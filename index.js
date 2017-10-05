const filendir = require('filendir');
const fs = require('fs');
const uuidv4 = require('uuid/v4');

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
	constructor(text) {
		super();
		this.ackId = uuidv4();
		this.text = text;
	}

	tryProcess(req, res, gamePrivate, playerNo) {
		const ackId = req.param('ackId');
		if (ackId === this.ackId) {
			// ACK ID matched -> proceed
			this.resolve();
		} else {
			// Not matching ACK ID -> serve the page
			gamePrivate.renderTemplate(res, playerNo, 'notice', { text: this.text, ackId: this.ackId, pendingLogs: this.pendingLogs });
		}
		return true;
	}
}

// Asks the user for input, with support for an optional validation callback.
// This state is blocking until an answer is returned and validated.
class RequestCommand extends Command {
	constructor(question, validateCb) {
		super();
		this.ackId = uuidv4();
		this.question = question;
		this.validateCb = validateCb;
	}

	serveQuestion(req, res, gamePrivate, playerNo, optError) {
		gamePrivate.renderTemplate(res, playerNo, 'request', { question: this.question, error: optError, ackId: this.ackId, pendingLogs: this.pendingLogs });
	}

	tryProcess(req, res, gamePrivate, playerNo) {
		// Either the data is provided and we proceed…
		const ackId = req.param('ackId');
		if (ackId === this.ackId) {
			const responseObj = {
				text: req.param('answer'),
				playerNo: playerNo,
				ok: () => {
					// Note that we don't answer to the request, the client is still waiting
					this.resolve(responseObj);
					return false;
				},
				reject: (reason) => {
					this.serveQuestion(req, res, gamePrivate, playerNo, reason);
					return true;
				}
			}
			if (this.validateCb) {
				return this.validateCb(responseObj);
			}
			return responseObj.ok();
		}

		// … or not and we serve the form
		this.serveQuestion(req, res, gamePrivate, playerNo);
		return true;
	}
}

// Shows a message to the user for a given amount of time.
// Unlike others, this state is not blocking, it resumes the execution straight to the next.
// TODO should be gone, and instead replaced by RequestCommand, just with another view to hide the Next button and trigger a click after timeout
class TimeoutCommand extends Command {
	constructor(text, timeout) {
		super();
		this.text = text;
		this.timeout = timeout;
	}

	tryProcess(req, res, gamePrivate, playerNo) {
		gamePrivate.renderTemplate(res, playerNo, 'flushLogs', { text: this.text, timeout: this.timeout, pendingLogs: this.pendingLogs });
		this.resolve();
		return true;
	}
}

// Private part of GamePublic. Internal methods.
class GamePrivate {
	constructor(gamePublic, engine, gameModule, userGameModule) {
		this.engine = engine;
		this.gameModule = gameModule;
		this.players = [];
		this.public = gamePublic;
		this.userGameModule = userGameModule;
	}
	// Adds a command for a given player. Snapshots logs until now and clears them. The command will output them.
	addCommand(playerNo, newCommand) {
		console.log(`Adding command for ${playerNo}`, newCommand);
		newCommand.addToList(this.players[playerNo].commands, this.players[playerNo].pendingLogs);
		this.players[playerNo].pendingLogs = '';
		// Save player data occasionally, not sure this is the best place
		this.engine.persistPlayerData(this.players[playerNo].playerName);
		return newCommand.promise;
	}
	addPlayer(playerName) {
		if (this.findPlayerNo(playerName) >= 0) throw new Error(`Player ${playerName} already part of this game!`);
		if (this.players.length >= this.requiredPlayers) throw new Error(`This game is already full! ${playerName} cannot join.`);
		const playerNo = this.players.length;
		const playerData = this.engine.getPlayerUserData(playerName);
		this.players.push({ playerName: playerName, waiting: false, pendingLogs: '', commands: [], data: playerData });
		// All joined -> start the game
		console.log(`Game has ${this.players.length}/${this.requiredPlayers}`);
		if (this.players.length === this.requiredPlayers) {
			console.log('Starting game');
			this.userGameModule.makeInstance(this.public).then(() => {
				console.log('Game finished');
				this.engine.persistPlayerData(playerName);
				this.gameModule.removeInstance(this);
			}).catch((ex) => {
				console.error('Game crashed, player data not saved', ex);
				this.gameModule.removeInstance(this);
			});
		}
		return playerNo;
	}
	// >= 0 if part of the game (player ID)
	findPlayerNo(playerName) {
		return this.players.findIndex(p => p.playerName === playerName);
	}
	// Appends to the pending logs for a given player.
	logToPlayer(playerNo, message) {
		this.players[playerNo].pendingLogs += message + '\n';
	}
	// Current count of players
	get numPlayers() {
		return this.players.length;
	}
	// Processes an express request
	processReq(playerNo, req, res) {
		console.log(`Processing request for ${playerNo}`, this.players[playerNo]);
		// Not enough players
		if (this.players.length < this.requiredPlayers) {
			return res.render('missingPlayers', { current: this.numPlayers, gameName: this.gameModule.gameName, total: this.requiredPlayers });
		}
		// This will switch to false if any command sends a response to the client
		// Else you may want to periodically call processReqForAnyPlayer
		this.players[playerNo].waiting = true;
		// An answer wasn't given to the player, try later
		if (!this.processReqForPlayer(playerNo, req, res) || this.players[playerNo].waiting) {
			this.renderTemplate(res, playerNo, 'pleaseWait', {});
		}
	}
	// You can call this is you just want to see if there's anything in the command buffer for a player
	processReqForPlayer(playerNo, req, res) {
		let processed = false;
		console.log(`Processing ${this.players[playerNo].commands.length} commands`);
		this.players[playerNo].commands.forEach(c => {
			if (!processed) {
				processed = c.tryProcess(req, res, this, playerNo);
			}
		});
		return processed;
	}
	// Renders a pug template to the user output. Required to be done at some point in a processReq.
	renderTemplate(res, playerNo, template, params) {
		res.render(template, params);
		this.players[playerNo].waiting = false;
	}
	// Required players to play
	get requiredPlayers() {
		return this.userGameModule.numPlayers;
	}
	// Adds a NoticeCommand for the user
	showNoticeToPlayer(playerNo, text, options) {
		options = options || {};
		console.log('OPTIONS', options);
		if (options.timeout) {
			return this.addCommand(playerNo, new TimeoutCommand(text, options.timeout));
		}
		return this.addCommand(playerNo, new NoticeCommand(text));
	}
	// Adds a RequestCommand for the user
	requestToPlayer(playerNo, question, options) {
		options = options || {};
		return this.addCommand(playerNo, new RequestCommand(question, options.validateCb));
	}
}

// Allows for various operations within the game. Pay attention to the async methods, which you need to use with await.
class GamePublic {
	constructor(engine, gameModule, userGameModule) {
		this.private = new GamePrivate(this, engine, gameModule, userGameModule);
	}

	// Player data, freely manipulable
	get player() {
		return this.private.players.map(player => player.data);
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

	// Requests input from the player (and blocks him until the call returns).
	// Options: validateCb=callback that receives a response where you can get .playerNo and .text, and call .ok() or .reject('reason').
	async requestToEveryone(question, options) {
		return await Promise.all(
			this.player.map((p, playerNo) => this.private.requestToPlayer(playerNo, question, options)));
	}
	async requestToPlayer(playerNo, question, options) {
		return await this.private.requestToPlayer(playerNo, question, options);
	}

	// Shows a notice to the player and returns when he presses the Next button.
	// Options: timeout=period where page auto-refreshes (do not pass to have a Next button).
	async showNoticeToEveryone(text, options) {
		return await Promise.all(
			this.player.map((p, playerNo) => this.private.showNoticeToPlayer(playerNo, text, options)));
	}
	async showNoticeToPlayer(playerNo, text, options) {
		return await this.private.showNoticeToPlayer(playerNo, text, options);
	}
}

// A game module references one user game (under `games/`). There should be one per game name. Also has:
// - Game instances: instance of the game, one per group of players.
// - User game module: the code of the game itself (the .js file under `games/<gameName>.js`).
class GameModule {
	// Note: the gameName must exist, else an exception is thrown!
	constructor(engine, gameName) {
		this.engine = engine;
		this.gameName = gameName;
		this.gameInstances = [];
		this.userGameModule = require(`./games/${gameName}`);
	}
	// Creates a new instance of this game module.
	createInstance(firstPlayerName) {
		// Debug check
		if (this.findPlayer(firstPlayerName)) throw new Error(`Player ${name} is already part of game ${this.gameName}`);
		// Create a container for this instance, with the current player
		const inst = new GamePublic(this.engine, this, this.userGameModule);
		this.gameInstances.push(inst.private);
		return inst.private;
	}
	// Returns an instance that requires an additional player (or null if none).
	findFreeInstance() {
		return this.gameInstances.find(i => i.numPlayers < i.requiredPlayers);
	}
	// Returns either null (not part of the game) or {instance, playerNo}
	findPlayer(playerName) {
		for (let i = 0; i < this.gameInstances.length; i += 1) {
			const playerNo = this.gameInstances[i].findPlayerNo(playerName);
			if (playerNo >= 0) return { instance: this.gameInstances[i], playerNo: playerNo };
		}
		return null;
	}
	// Front-end for an Express.js request.
	processRequest(req, res, playerName) {
		// Playing in this game? (instance, playerNo within this instance)
		const playerInGame = this.findPlayer(playerName);
		// In game -> route the request
		if (playerInGame) {
			playerInGame.instance.processReq(playerInGame.playerNo, req, res);
			return;
		}
		// Not in game, check if the player is doing some other game
		this.engine.removePlayerFromRunningGame(playerName);
		// Not in game, find a free instance
		let instance = this.findFreeInstance();
		if (!instance) {
			// No free instance, create one
			console.log(`Creating instance of ${this.gameName} for ${playerName}`);
			instance = this.createInstance(playerName);
		}
		console.log(`Adding ${playerName} to instance of ${this.gameName}`);
		const playerNo = instance.addPlayer(playerName);
		instance.processReq(playerNo, req, res);
	}
	// Removes an instance, usually once finished
	removeInstance(gamePrivate) {
		const found = this.gameInstances.indexOf(gamePrivate);
		if (found < 0) throw new Error(`Removing non-existing instance of game ${this.gameName}`);
		console.log(`Removing instance ${found}/${this.gameInstances.length} of ${this.gameName}`);
		this.gameInstances.splice(found, 1);
	}
}

// Represents an existing player. Call fetch() on it after creation to populate it with data from the DB.
class PlayerState {
	constructor(playerName) {
		this.currentGame = null;
		this.playerName = playerName;
		this.userData = {};
	}
	// Fetch user data from disk. Throws an exception in case the file doesn't exist.
	fetch() {
		this.userData = JSON.parse(fs.readFileSync(`./db/players/${this.playerName}.json`).toString());
		return this;
	}
	// Persists any change to the disk. Call after modification.
	persist() {
		filendir.writeFileSync(`./db/players/${this.playerName}.json`, JSON.stringify(this.userData));
		return this;
	}
}

// Front-end class for the main request processing engine
class Engine {
	constructor() {
		this.gameModules = {};
		this.playerStates = {};
	}
	// Gets user player data for a given player, loading it from disk if needed.
	// Note: the player MUST exist (use playerExists in case of doubt) or an exception is thrown.
	getPlayerUserData(playerName) {
		// Load it from disk if not existing
		if (!this.playerStates[playerName]) {
			this.playerStates[playerName] = new PlayerState(playerName).fetch();
		}
		return this.playerStates[playerName].userData;
	}
	// After loading the game, you need to create instances
	loadGameModuleIfNeeded(gameName) {
		if (this.gameModules[gameName]) return this.gameModules[gameName];
		try {
			return this.gameModules[gameName] = new GameModule(this, gameName);
		} catch (e) {
			return console.error(`Failed to load the game ${gameName}`, e);
		}
	}
	// Call after modification.
	persistPlayerData(playerName) {
		if (!this.playerStates[playerName]) throw new Error(`Player ${playerName} does not exist or is not loaded`);
		this.playerStates[playerName].persist();
	}
	// Checks whether the player with a given name exists.
	playerExists(playerName) {
		try {
			return !!this.getPlayerUserData(playerName);
		} catch (e) {
			console.error(e);
			return false;
		}
	}
	playerNameValid(playerName) {
		return /^[a-z][0-9a-z-_]*$/.test(playerName);
	}
	// Process an Express.js request, routing it to the right game
	processRequest(req, res, gameName, playerName) {
		const gameModule = this.loadGameModuleIfNeeded(gameName);
		playerName = playerName.toLowerCase();
		if (!this.playerNameValid(playerName)) {
			return res.render('error', { message: `Invalid username ${playerName}` });
		}
		if (!this.playerExists(playerName)) {
			// Auto-register the user if he doesn't exist
			this.playerStates[playerName] = new PlayerState(playerName);
			return res.render('error', { message: `Registered your account, ${playerName}! Welcome, and please refresh the page.` });
		}
		if (!gameModule) {
			return res.render('error', { message: `No game ${gameName}` });
		}
		return gameModule.processRequest(req, res, playerName);
	}
	removePlayerFromRunningGame(playerName) {
		// Find any game the player is playing and remove the instance
		for (let key in this.gameModules) {
			if (this.gameModules.hasOwnProperty(key)) {
				const gameModule = this.gameModules[key];
				const foundPlayer = gameModule.findPlayer(playerName);
				if (foundPlayer) {
					// Since the game doesn't make any sense without the player, let's simply remove the instance itself
					gameModule.removeInstance(foundPlayer.instance);
				}
			}
		}
	}
	// Unloads a game module and sends a confirmation to the response
	unloadGameModule(gameName, res) {
		if (this.gameModules[gameName]) {
			this.gameModules[gameName] = null;
			delete require.cache[require.resolve(`./games/${gameName}`)];
			return res.send('OK');
		}
		return res.send(`Module ${gameName} not loaded`);
	}
}

// -------------------------------------------------
const express = require('express');
const app = express();
const engine = new Engine();

app.set('view engine', 'pug');

app.get('/reload/:gameName', function (req, res) {
	engine.unloadGameModule(req.param('gameName'), res);
});

app.get('/player/:playerName', function (req, res) {
	engine.processRequest(req, res, 'home', req.param('playerName'));
});

app.get('/player/:playerName/:gameName', function (req, res) {
	engine.processRequest(req, res, req.param('gameName'), req.param('playerName'));
});

app.listen(3000);
