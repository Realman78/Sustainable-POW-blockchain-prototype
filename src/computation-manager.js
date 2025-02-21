const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const path = require('path');

class ComputationManager {
  constructor(options = {}) {
    this.maxPendingTasks = options.maxPendingTasks || 100;
    this.taskTimeout = options.taskTimeout || 300000; // 5 minutes
    this.pendingTasks = new Map(); // taskId -> task
    this.completedTasks = new Map(); // taskId -> result
    this.verifiers = new Map(); // taskType -> verification function
    
    // Register built-in computation types
    this.registerTask('factorize', {
      verify: (task, result) => {
        const factors = JSON.parse(result.output);
        // Verify factors multiply to original number
        const product = factors.reduce((a, b) => a * b, 1);
        return product === parseInt(task.args);
      }
    });
  }

  registerTask(taskType, { verify }) {
    this.verifiers.set(taskType, verify);
  }

  addTask(task, addedAt = Date.now()) {
    if (this.pendingTasks.size >= this.maxPendingTasks) {
      throw new Error('Maximum pending tasks limit reached');
    }

    if (!this.verifiers.has(task.executable)) {
      throw new Error(`Unknown computation type: ${task.executable}`);
    }

    // Basic task validation
    if (!task.taskId || !task.executable || !task.args) {
      throw new Error('Invalid task format');
    }

    // Add timestamp for timeout tracking
    const taskWithMeta = {
      ...task,
      addedAt
    };
    console.log('taskWithMeta :>> ', taskWithMeta);

    this.pendingTasks.set(task.taskId, taskWithMeta);
  }

  async executeTask(task) {
    try {
      const scriptPath = path.join(__dirname, 'computations', `${task.executable}.js`);
      const { stdout } = await execAsync(`node ${scriptPath} ${task.args}`);
      
      return {
        taskId: task.taskId,
        output: stdout.trim(),
        executedAt: Date.now()
      };
    } catch (error) {
      throw new Error(`Computation failed: ${error.message}`);
    }
  }

  verifyResult(task, result) {
    const verifier = this.verifiers.get(task.executable);
    if (!verifier) {
      throw new Error(`No verifier found for task type: ${task.executable}`);
    }

    return verifier(task, result);
  }

  addCompletedTask(result) {
    const task = this.pendingTasks.get(result.taskId);
    if (!task) {
      throw new Error('No pending task found for this result');
    }

    if (!this.verifyResult(task, result)) {
      throw new Error('Result verification failed');
    }

    this.completedTasks.set(result.taskId, result);
    this.pendingTasks.delete(result.taskId);
  }

  getTasksForBlock(maxTasks = 10) {
    // Get oldest tasks first
    return Array.from(this.pendingTasks.values())
      .sort((a, b) => a.addedAt - b.addedAt)
      .slice(0, maxTasks);
  }

  cleanExpiredTasks() {
    const now = Date.now();
    for (const [taskId, task] of this.pendingTasks.entries()) {
      if (now - task.addedAt > this.taskTimeout) {
        this.pendingTasks.delete(taskId);
      }
    }
  }

  isTaskPending(taskId) {
    return this.pendingTasks.has(taskId);
  }

  isTaskCompleted(taskId) {
    return this.completedTasks.has(taskId);
  }

  getCompletedTaskResult(taskId) {
    return this.completedTasks.get(taskId);
  }
}

module.exports = ComputationManager;