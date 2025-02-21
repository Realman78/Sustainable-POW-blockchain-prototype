const { parentPort } = require('worker_threads');
const { Block } = require('./blockchain');
const crypto = require('crypto');
const { factorize } = require('./example-tasks/factorize');
const { discreteLogarithm } = require('./example-tasks/discrete-logarithm');

console.log("Useful worker started");

let isCancelled = false;

// Add handler for termination
parentPort.on('close', () => {
  isCancelled = true;
});

parentPort.on('message', async (data) => {
  console.log("useful worker received data:", data);
  const { pendingCalculations } = data;


  try {
    console.log("Useful worker starting to mine block");
    for (const { executable, args, taskId } of pendingCalculations) {
      let res, hashedRes;
      switch (executable) {
        case 'discreteLog':
          res.push(discreteLogarithm(...args));
          parentPort.postMessage({ status: 'DONE', taskId, output: res});
          break;
        case 'factorize':
          res = factorize(...args);
          parentPort.postMessage({ status: 'DONE', taskId, output: res,});
          break;
        default:
          throw new Error(`Unknown executable: ${executable}`);
      }
    }
    // parentPort.postMessage({ status: 'ALL_DONE', taskId, output: res, hashedOutput: hashedRes});
    process.exit(0);

  } catch (error) {
    console.error("Worker calculation error:", error);
    parentPort.postMessage({ status: 'aborted' });
    process.exit(1);
  }
});

// Handle any errors in the worker
parentPort.on('error', (error) => {
  console.error("calculation worker error:", error);
  process.exit(1);
});