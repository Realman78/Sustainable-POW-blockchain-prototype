const { exec } = require('child_process');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('Enter the name of the file in the example-tasks folder: ', (_fileNameAndArgs) => {
    const fileNameAndArgs = _fileNameAndArgs.split(' ');
    const filePath = path.join(__dirname, 'example-tasks', fileNameAndArgs[0]);
    const args = fileNameAndArgs.slice(1).join(' ');
    exec(`node ${filePath}.js ${args}`, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error executing file: ${error.message}`);
            return;
        }

        if (stderr) {
            console.error(`Error output: ${stderr}`);
            return;
        }

        console.log(`Output: ${stdout}`);
    });

    rl.close();
});