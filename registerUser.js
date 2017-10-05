const filendir = require('filendir');
const fs = require('fs');

const playerName = process.argv[2];
if (!playerName) {
	return console.error('Usage: npm run registerUser USER_NAME');
}
if (!/^[A-Za-z][0-9A-Za-z-_]*$/.test(playerName)) {
	return console.error(`Unsupported player name ${playerName}. Use letters and digits only.`)
}
const fileName = `./db/players/${playerName}.json`;
if (fs.existsSync(fileName)) {
	return console.error(`Player ${playerName} already exists.`);
}
filendir.writeFileSync(fileName, JSON.stringify({}));
console.log(`Registered player ${playerName}!`);
