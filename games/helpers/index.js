exports.coinToss = () => randomInt(0, 2) === 0;

exports.inParallel = async function(...funs) {
	return await Promise.all(funs);
}

exports.random = (min, max) => Math.random() * (max - min) + min;

exports.randomInt = (min, max) => {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
};
