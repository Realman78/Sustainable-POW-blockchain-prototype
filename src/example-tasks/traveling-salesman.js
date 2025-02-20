export function tspBruteForce(distances) {
    const cities = Array.from({ length: distances.length }, (_, i) => i);

    function permute(arr, prefix = []) {
        if (arr.length === 0) return [prefix];
        return arr.flatMap((v, i) => permute(arr.slice(0, i).concat(arr.slice(i + 1)), prefix.concat(v)));
    }

    const permutations = permute(cities);
    let minDistance = Infinity;
    let bestRoute = null;

    for (const route of permutations) {
        let distance = 0;
        for (let i = 0; i < route.length - 1; i++) {
            distance += distances[route[i]][route[i + 1]];
        }
        distance += distances[route[route.length - 1]][route[0]]; // Return to start
        if (distance < minDistance) {
            minDistance = distance;
            bestRoute = route;
        }
    }

    return { route: bestRoute, distance: minDistance };
}

// const distances = [
//     [0, 10, 15, 20],
//     [10, 0, 35, 25],
//     [15, 35, 0, 30],
//     [20, 25, 30, 0]
// ];
// console.log(tspBruteForce(distances));
// // { route: [0, 1, 3, 2], distance: 80 }
