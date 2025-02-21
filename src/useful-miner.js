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

// Task execution functions map
const taskExecutors = {
  factorize: async (args) => {
    // Parse arguments if they're passed as strings
    const parsedArgs = args.map(arg => parseInt(arg));
    return factorize(...parsedArgs);
  },
  discreteLog: async (args) => {
    const parsedArgs = args.map(arg => parseInt(arg));
    return discreteLogarithm(...parsedArgs);
  }
};

// Task verification functions
const verifyTask = (taskType, args, result) => {
  switch (taskType) {
    case 'factorize':
      // Verify factorization by multiplying factors
      const product = result.reduce((a, b) => a * b, 1);
      return product === parseInt(args[0]);
    case 'discreteLog':
      // Add verification for discrete logarithm
      // ... discrete log verification logic here
      return true;
    default:
      throw new Error(`Unknown task type: ${taskType}`);
  }
};

async function executeTask(task) {
  const { executable, args, taskId } = task;
  
  // Check if task executor exists
  if (!taskExecutors[executable]) {
    throw new Error(`Unknown executable: ${executable}`);
  }

  try {
    // Execute the task
    console.log(`Executing ${executable} with args:`, args);
    const result = await taskExecutors[executable](args.split(' '));

    // Verify the result
    if (!verifyTask(executable, args.split(' '), result)) {
      throw new Error('Result verification failed');
    }

    return {
      status: 'DONE',
      taskId,
      output: result,
      executedAt: Date.now()
    };
  } catch (error) {
    return {
      status: 'FAILED',
      taskId,
      error: error.message
    };
  }
}

parentPort.on('message', async (data) => {
  console.log("Useful worker received data:", data);
  const { pendingCalculations } = data;

  try {
    console.log("Useful worker processing calculations:", pendingCalculations.length);
    
    for (const task of pendingCalculations) {
      if (isCancelled) {
        console.log("Task execution cancelled");
        break;
      }

      const result = await executeTask(task);
      parentPort.postMessage(result);

      // Short delay between tasks to prevent CPU overload
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log("All tasks completed");
    process.exit(0);

  } catch (error) {
    console.error("Worker calculation error:", error);
    parentPort.postMessage({ 
      status: 'ERROR',
      error: error.message 
    });
    process.exit(1);
  }
});

// Handle any errors in the worker
parentPort.on('error', (error) => {
  console.error("Calculation worker error:", error);
  process.exit(1);
});

// Handle unhandled rejections
process.on('unhandledRejection', (error) => {
  console.error("Unhandled rejection in worker:", error);
  process.exit(1);
});