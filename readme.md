# discord analysis

Analyze your discord messages and put them into a neat little HTML file.

## Installation

1. Request a copy of your data from Discord. [Learn how to do that here](https://support.discord.com/hc/en-us/articles/360004027692-Requesting-a-Copy-of-your-Data)
1. Install Node.js from [here](https://nodejs.org/en/download/)
1. Clone this repository (or download it as a zip and extract it)
1. Open a command prompt (or equivalent) in the folder you cloned the repository to
1. Run `npm install`
1. Place your (zipped) discord data in the folder and rename it to `data.zip`
1. Run `node index.js`
1. Wait for it to finish
1. Tada! The script will open a browser window with the results

## Usage

The following command line arguments are available:
| Argument | Default| Description |
| --- | --- | --- |
| `-h`, `--help` | | Show help |
| `-d`, `--data <path>` | `data.zip` | Path to the data file |
| `-o`, `--output <path>`| `stats.json` | Path to the output file |
| `-v`, `--visualize` |`true`| Visualize the data in an HTML file |
| `-n`, `--no-parse` |`false`| Don't parse the data, just visualize it (using a previously parsed dataset) |
| `-p`, `--no-open` |`false`| Do not open the `stats.html` file in the browser |
