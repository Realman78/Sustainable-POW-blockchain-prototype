const { parentPort } = require('worker_threads');
const { Block } = require('./blockchain');

parentPort.on('message', async (data) => {
  const { blockData, difficulty } = data;

  const block = new Block(
    blockData.timestamp,
    blockData.transactions,
    blockData.previousHash
  );

  try {
    await block.mineBlock(difficulty, false);
    parentPort.postMessage({ status: 'mined', block });
  } catch (error) {
    parentPort.postMessage({ status: 'aborted' });
  }
});
