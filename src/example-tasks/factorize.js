function factorize(N) {
    const factors = [];
    let divisor = 2;

    while (N > 1) {
        while (N % divisor === 0) {
            factors.push(divisor);
            N = Math.floor(N / divisor);
        }
        divisor++;
    }

    return factors;
}

console.log(factorize(process.argv[2]));

module.exports = { factorize };
// console.log(factorize(60)); // [2, 2, 3, 5]
