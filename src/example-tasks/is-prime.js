function isPrime(num) {
    if (num < 2) return false;
    for (let i = 2, sqrt = Math.sqrt(num); i <= sqrt; i++) {
        if (num % i === 0) return false;
    }
    return true;
}

function nextPrime(N) {
    let candidate = N + 1;
    while (!isPrime(candidate)) {
        candidate++;
    }
    return candidate;
}

// // Example Usage
// console.log(nextPrime(10)); // Output: 11
// console.log(nextPrime(17)); // Output: 19
