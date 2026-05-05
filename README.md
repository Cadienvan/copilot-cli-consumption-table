## How to use this

1. Clone this repository and navigate to the project directory.
2. Run `npm install` to install the necessary dependencies.
3. Run `npm run start` to execute the data extraction and analysis process. This will:
     - Clear the `output` and `data` directories.
     - Extract session data using the `extract-sessions.sh` script.
     - Analyze the extracted session data and generate a report in the `output` directory.
4. Open a Live Server in the root and analyze the data.

Watch out: This only works for Copilot CLI, as VSCode's Copilot extension does not store session data in the same way and logs are a mess to look at.