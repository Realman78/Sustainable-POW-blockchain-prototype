const { parentPort } = require('worker_threads');
const { Block } = require('./blockchain');

console.log("Worker started");

let isCancelled = false;

// Add handler for termination
parentPort.on('close', () => {
  isCancelled = true;
});

// Also handle SIGTERM
process.on('SIGTERM', () => {
  isCancelled = true;
});

parentPort.on('message', async (data) => {
  console.log("Worker received data:", data);
  const { blockData, difficulty, delayed } = data;

  const block = new Block(
    blockData.timestamp,
    blockData.transactions,
    blockData.computationResults,
    blockData.previousHash,
  );

  try {
    console.log("Worker starting to mine block");
    await block.mineBlock(difficulty, delayed, () => isCancelled);
    
    if (!isCancelled) {
      console.log("Worker finished mining block");
      parentPort.postMessage({ status: 'mined', block });
    } else {
      console.log("Mining was cancelled");
      parentPort.postMessage({ status: 'aborted' });
    }
    process.exit(0);
  } catch (error) {
    console.error("Worker mining error:", error);
    parentPort.postMessage({ status: 'aborted' });
    process.exit(1);
  }
});

// Handle any errors in the worker
parentPort.on('error', (error) => {
  console.error("Worker error:", error);
  process.exit(1);
});