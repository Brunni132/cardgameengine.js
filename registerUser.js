const filendir = require('filendir');
const fs = require('fs');

let playerName = process.argv[2];
if (!playerName) {
	return console.error('Usage: npm run registerUser USER_NAME');
}
// Note: player names are always lowercase
playerName = playerName.toLowerCase();
if (!/^[a-z][0-9a-z-_]*$/.test(playerName)) {
	return console.error(`Unsupported player name ${playerName}. Use letters and digits only.`)
}
const fileName = `./db/players/${playerName}.json`;
if (fs.existsSync(fileName)) {
	return console.error(`Player ${playerName} already exists.`);
}
filendir.writeFileSync(fileName, JSON.stringify({}));
console.log(`Registered player ${playerName}!`);
