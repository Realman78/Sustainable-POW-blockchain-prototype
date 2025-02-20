// g^x % p = h
function discreteLogarithm(g, h, p, multi = 1) {
    for (let x = 0; x < p*multi; x++) {
        if (Math.pow(g, x) % p === h) {
            return x;
        }
    }
    return -1;
}

module.exports = { discreteLogarithm };
// console.log(discreteLogarithm(2, 8, 13)); // output: 3 (2^3 % 13 = 8)
