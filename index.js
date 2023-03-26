const JSZip = require("jszip");
const { SentimentAnalyzer, PorterStemmer } = require("natural");
const natural = require("natural");
const Analyzer = new SentimentAnalyzer("English", PorterStemmer, "afinn");
const aposToLex = require("apos-to-lex-form"); // as in "apostrophe to standard lexicon form" (e.g. "don't" to "do not")
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
let messages = [];
const tokenizer = new natural.WordTokenizer();
const stopWords = require("stopwords").english; // stopword is a list of common words that should be filtered out before processing text
const zip = new JSZip();
const node_process = require("process");
const { program } = require("commander");

let profanities = require("./profane.json");
profanities = profanities.map((profanity) => new RegExp(profanity, "gi"));

program
	.option("-d, --data <path>", "path to data.zip", "data.zip")
	.option("-o, --output <path>", "path to output.json", "stats.json")
	.option("-v --visualize", "visualize data", true)
	.option("-n --no-parse", "do not parse data", true)
	.option("-p --no-open", "open in browser", true);

program.parse(node_process.argv);
const options = program.opts();

// Load the zip file
const loadPackage = async () => {
	console.log("Loading data...");
	await zip.loadAsync(fs.readFileSync(options.data)).then((zip) => {
		zip.folder("messages").forEach((relativePath, file) => {
			// ever FOLDER in the messages folder is a channel
			// but there are also files in the messages folder that we don't care about
			if (file.dir) {
				// if the file is a directory, then we know it is a channel
				// get the messages.csv file from the channel
				const csv = zip
					.file(`messages/${relativePath}messages.csv`)
					.async("string")
					.then((csv) => {
						// convert the csv file to a json object
						let records = parse(csv, {
							columns: true,
							// quote: false,
							record_delimiter: "\n",
							ignore_last_delimiters: true,
							relax_column_count_less: true,
						});
						records = records.filter((record) => record.Contents);
						records = records.map((record) => {
							return {
								date: new Date(record.Timestamp),
								content: record.Contents,
							};
						});
						messages.push(...records);
						// wait for the zip file to be loaded
						// then process the data
						// then write the data to a file
					});
			}
		});
	});
};
if (options.parse) {
	loadPackage();
	setTimeout(() => {
		process();
		if (options.visualize) {
			makeDOM();
		}
	}, 1000);
} else {
	console.log("Skipping data parsing");
	if (options.visualize) {
		makeDOM();
	}
}

const process = () => {
	console.log("Done loading data!");
	console.log("Processing data...");
	// time to process the data!
	// will be eventually written to a JSON file

	let stats = {
		totalMessages: messages.length,
		totalWords: 0,
		totalUniqueWords: 0,
		averageWordsPerMessage: 0,
		totalProfanity: 0,
		averageProfanityPerMessage: 0,
		averageSentiment: 0,
		wordFrequency: {},
		profanityFrequency: {},
		dataPeriods: [],
	};
	let sentiments = [];
	let words = [];
	let profanity = [];
	messages.map((message) => {
		message = message.content;
		message = aposToLex(message);
		message = message.toLowerCase();
		message = tokenizer.tokenize(message);
		message = message.filter((word) => !stopWords.includes(word));
		message = message.filter((word) => word.length > 1);
		message = message.filter((word) => !word.includes("http"));

		// get the sentiment of the message
		let sentiment = Analyzer.getSentiment(message);
		sentiment = isNaN(sentiment) ? 0 : sentiment;
		sentiments.push(sentiment);
		words.push(...message);

		// get the profanity of the message
		let profanityCount = 0;
		profanities.forEach((profanity) => {
			if (profanity.test(message)) {
				profanityCount++;
			}
		});
		profanity.push(profanityCount);
		if (profanityCount > 0) {
			stats.totalProfanity++;
		}

		return message;
	});
	stats.totalWords = words.length;
	stats.totalUniqueWords = new Set(words).size;
	stats.averageWordsPerMessage = stats.totalWords / stats.totalMessages;
	stats.averageSentiment =
		sentiments.reduce((a, b) => a + b, 0) / sentiments.length;
	words.forEach((word) => {
		if (isNaN(word)) {
			if (stats.wordFrequency[word]) {
				stats.wordFrequency[word].count += 1;
			} else {
				stats.wordFrequency[word] = {
					count: 1,
					sentiment: Analyzer.getSentiment([word]),
				};
			}

			// if profane, add to profanity frequency
			profanities.forEach((profanity) => {
				if (profanity.test(word)) {
					if (stats.profanityFrequency[word]) {
						stats.profanityFrequency[word].count += 1;
					} else {
						stats.profanityFrequency[word] = {
							count: 1,
							sentiment: Analyzer.getSentiment([word]),
						};
					}
				}
			});
		}
	});

	stats.averageProfanityPerMessage =
		profanity.reduce((a, b) => a + b, 0) / profanity.length;

	// sort the word frequency by frequency
	stats.wordFrequency = Object.fromEntries(
		Object.entries(stats.wordFrequency).sort(
			([, a], [, b]) => b.count - a.count
		)
	);

	// sort the profanity frequency by frequency
	stats.profanityFrequency = Object.fromEntries(
		Object.entries(stats.profanityFrequency).sort(
			([, a], [, b]) => b.count - a.count
		)
	);

	// for data periods:
	// start with oldest message, then take snapshots every 30 days
	// these snapshots should be the total words, total unique words (as in, this is the first time its appeared in the user's vocabulary), total profanity, average sentiment, average profanity, and average words per message
	// as well as the top 50 words and top 50 profanities (if any)

	// sort the messages by date
	messages.sort((a, b) => a.date - b.date);
	let oldestMessage = messages[0].date;
	let newestMessage = messages[messages.length - 1].date;
	let numberOfDataPeriods = Math.ceil(
		(newestMessage - oldestMessage) / (30 * 24 * 60 * 60 * 1000)
	);
	let currentDate = oldestMessage;
	let currentMessages = [];
	let currentWords = [];
	let currentProfanity = [];
	let currentSentiments = [];
	let currentProfanityWords = [];
	let currentProfanitySentiments = [];
	let currentProfanityCount = 0;
	let currentWordFrequency = {};
	let currentProfanityFrequency = {};
	let firstTimeWords = {};
	for (let i = 0; i < numberOfDataPeriods; i++) {
		node_process.stdout.clearLine(0);
		node_process.stdout.cursorTo(0);
		node_process.stdout.write(
			`Processing data period ${i + 1} of ${numberOfDataPeriods}...`
		);

		let currentPeriod = {
			startDate: currentDate,
			endDate: new Date(currentDate.getTime() + 30 * 24 * 60 * 60 * 1000),
			totalMessages: 0,
			totalWords: 0,
			totalFirstTimeWords: 0,
			totalUniqueWords: 0,
			totalProfanity: 0,
			averageWordsPerMessage: 0,
			averageSentiment: 0,
			averageProfanityPerMessage: 0,
			wordFrequency: {},
			profanityFrequency: {},
		};
		messages.forEach((message) => {
			if (
				message.date >= currentDate &&
				message.date <= currentPeriod.endDate
			) {
				currentMessages.push(message);
			}
		});
		currentMessages.forEach((message) => {
			message = message.content;
			message = aposToLex(message);
			message = message.toLowerCase();
			message = tokenizer.tokenize(message);
			message = message.filter((word) => !stopWords.includes(word));
			message = message.filter((word) => word.length > 1);
			message = message.filter((word) => !word.includes("http"));
			currentWords.push(...message);
			let sentiment = Analyzer.getSentiment(message);
			sentiment = isNaN(sentiment) ? 0 : sentiment;
			currentSentiments.push(sentiment);
			let profanityCount = 0;
			profanities.forEach((profanity) => {
				if (profanity.test(message)) {
					profanityCount++;
				}
			});
			currentProfanity.push(profanityCount);
			if (profanityCount > 0) {
				currentProfanityCount++;
			}
			return message;
		});
		currentPeriod.totalMessages = currentMessages.length;
		currentPeriod.totalWords = currentWords.length;
		currentPeriod.totalUniqueWords = new Set(currentWords).size;
		currentPeriod.averageWordsPerMessage =
			currentPeriod.totalWords / currentPeriod.totalMessages;
		currentPeriod.averageSentiment =
			currentSentiments.reduce((a, b) => a + b, 0) /
			currentSentiments.length;
		currentWords.forEach((word) => {
			if (isNaN(word)) {
				if (currentWordFrequency[word]) {
					currentWordFrequency[word].count += 1;
				} else {
					currentWordFrequency[word] = {
						count: 1,
						sentiment: Analyzer.getSentiment([word]),
					};
				}
				if (!firstTimeWords[word]) {
					firstTimeWords[word] = true;
					currentPeriod.totalFirstTimeWords++;
				}
				// if profane, add to profanity frequency
				profanities.forEach((profanity) => {
					if (profanity.test(word)) {
						if (currentProfanityFrequency[word]) {
							currentProfanityFrequency[word].count += 1;
						} else {
							currentProfanityFrequency[word] = {
								count: 1,
								sentiment: Analyzer.getSentiment([word]),
							};
						}
					}
				});
			}
		});

		// limit the word frequency to 50
		let wordFrequencyKeys = Object.keys(currentWordFrequency);
		if (wordFrequencyKeys.length > 50) {
			wordFrequencyKeys = wordFrequencyKeys.slice(0, 50);
		}
		wordFrequencyKeys.forEach((key) => {
			currentPeriod.wordFrequency[key] = currentWordFrequency[key];
		});
		// now get rid of all of the words not in the top 50
		Object.keys(currentWordFrequency).forEach((key) => {
			if (!wordFrequencyKeys.includes(key)) {
				delete currentWordFrequency[key];
			}
		});

		// limit the profanity frequency to 50
		let profanityFrequencyKeys = Object.keys(currentProfanityFrequency);
		if (profanityFrequencyKeys.length > 50) {
			profanityFrequencyKeys = profanityFrequencyKeys.slice(0, 50);
		}
		profanityFrequencyKeys.forEach((key) => {
			currentPeriod.profanityFrequency[key] =
				currentProfanityFrequency[key];
		});
		// now get rid of all of the words not in the top 50
		Object.keys(currentProfanityFrequency).forEach((key) => {
			if (!profanityFrequencyKeys.includes(key)) {
				delete currentProfanityFrequency[key];
			}
		});

		currentPeriod.totalProfanity = currentProfanityCount;
		currentPeriod.averageProfanityPerMessage =
			currentProfanity.reduce((a, b) => a + b, 0) /
			currentProfanity.length;
		currentPeriod.wordFrequency = Object.fromEntries(
			Object.entries(currentWordFrequency).sort(
				([, a], [, b]) => b.count - a.count
			)
		);
		currentPeriod.profanityFrequency = Object.fromEntries(
			Object.entries(currentProfanityFrequency).sort(
				([, a], [, b]) => b.count - a.count
			)
		);
		stats.dataPeriods.push(currentPeriod);
		currentDate = new Date(
			currentDate.getTime() + 30 * 24 * 60 * 60 * 1000
		);
		currentMessages = [];
		currentWords = [];
		currentProfanity = [];
		currentSentiments = [];
		currentProfanityWords = [];
		currentProfanitySentiments = [];
		currentProfanityCount = 0;
		currentWordFrequency = {};
		currentProfanityFrequency = {};
	}

	console.log("\nWriting stats.json");
	fs.writeFileSync(options.output, JSON.stringify(stats, null, 4));
	console.log("Done! Enjoy your stats!");
};

function makeDOM() {
	const chartSizeX = 400;
	const chartSizeY = 0.75 * chartSizeX;

	console.log("Making DOM");
	const stats = require(path.resolve(options.output));
	const jsdom = require("jsdom");
	const { JSDOM } = jsdom;
	const dom = new JSDOM(
		`<!DOCTYPE html><html><head></head><body></body></html>`
	);
	const document = dom.window.document;

	// will be using chart.js
	let script = document.createElement("script");
	script.src =
		"https://cdn.jsdelivr.net/npm/chart.js@4.2.1/dist/chart.umd.min.js";
	document.head.appendChild(script);

	// load the data into a script tag
	script = document.createElement("script");
	script.innerHTML = `
    const dataPeriods = ${JSON.stringify(
		stats.dataPeriods.map((period) => {
			return {
				...period,
				startDate: new Date(period.startDate).toLocaleDateString(),
				endDate: new Date(period.endDate).toLocaleDateString(),
			};
		})
	)};
    `;
	document.head.appendChild(script);

	script = document.createElement("script");
	script.innerHTML = `
    const wordFrequency = ${JSON.stringify(stats.wordFrequency)};
    const profanityFrequency = ${JSON.stringify(stats.profanityFrequency)};
    `;

	//general stats
	let div = document.createElement("div");
	div.classList.add("general-stats");
	div.innerHTML = `
    <h1>General Stats</h1>
    <p>Total Messages: ${stats.totalMessages.toLocaleString()}</p>
    <p>Total Words: ${stats.totalWords.toLocaleString()}</p>
    <p>Total Unique Words: ${stats.totalUniqueWords.toLocaleString()}</p>
    <p>Total Profanity: ${stats.totalProfanity.toLocaleString()}</p>
    <p>Average Words Per Message: ${stats.averageWordsPerMessage.toLocaleString()}</p>
    <p>Average Profanity Per Message: ${stats.averageProfanityPerMessage.toLocaleString()}</p>
    <p>Average Sentiment: ${stats.averageSentiment.toLocaleString()}</p>
    `;
	document.body.appendChild(div);

	// add the sentiment over time chart
	let canvas = document.createElement("canvas");
	canvas.id = "sentimentOverTime";
	canvas.width = chartSizeX;
	canvas.height = chartSizeY;
	document.body.appendChild(canvas);
	script = document.createElement("script");
	script.innerHTML = `
    const sentimentOverTime = document.getElementById("sentimentOverTime");
    const sentimentOverTimeChart = new Chart(sentimentOverTime, {
        type: "line",
        data: {
            labels: dataPeriods.map((period) => period.startDate),
            datasets: [{
                label: "Average Sentiment",
                data: dataPeriods.map((period) => period.averageSentiment),
                backgroundColor: "rgba(255, 99, 132, 0.2)",
                borderColor: "rgba(255, 99, 132, 1)",
                borderWidth: 1,
            }]
        },
        options: {
            responsive: false,
            color: "#ffffff",
            plugins: {
                legend: {
                    labels: {
                        color: "#d5d5d5",
                    },
                },
            },
            scales: {
                yAxes: [{
                    ticks: {
                        color: "#d5d5d5",
                    }
                }],
                xAxes: [{
                    ticks: {
                        color: "#d5d5d5",
                    }
                }]
            }
        },

    })
    `;
	document.body.appendChild(script);

	// add the profanity over time chart
	canvas = document.createElement("canvas");
	canvas.id = "profanityOverTime";
	canvas.width = chartSizeX;
	canvas.height = chartSizeY;
	document.body.appendChild(canvas);
	script = document.createElement("script");
	script.innerHTML = `
    const profanityOverTime = document.getElementById("profanityOverTime");
    const profanityOverTimeChart = new Chart(profanityOverTime, {
        type: "line",
        data: {
            labels: dataPeriods.map((period) => period.startDate),
            datasets: [{
                label: "Average Profanity Per Message",
                data: dataPeriods.map((period) => period.averageProfanityPerMessage),
                backgroundColor: "rgba(255, 99, 132, 0.2)",
                borderColor: "rgba(255, 99, 132, 1)",
                borderWidth: 1,
            }]
        },
        options: {
            responsive: false,
            color: "#ffffff",
            plugins: {
                legend: {
                    labels: {
                        color: "#d5d5d5",
                    },
                },
            },
            scales: {
                yAxes: [{
                    ticks: {
                        color: "#d5d5d5",
                    },
                }],
                xAxes: [{
                    ticks: {
                        color: "#d5d5d5",
                    },
                }],
            },
        },
    })
    `;
	document.body.appendChild(script);

	// total profanity over time
	canvas = document.createElement("canvas");
	canvas.id = "totalProfanityOverTime";
	canvas.width = chartSizeX;
	canvas.height = chartSizeY;
	document.body.appendChild(canvas);
	script = document.createElement("script");
	script.innerHTML = `
    const totalProfanityOverTime = document.getElementById("totalProfanityOverTime");
    const totalProfanityOverTimeChart = new Chart(totalProfanityOverTime, {
        type: "line",
        data: {
            labels: dataPeriods.map((period) => period.startDate),
            datasets: [{
                label: "Total Profanity",
                data: dataPeriods.map((period) => period.totalProfanity),
                backgroundColor: "rgba(255, 99, 132, 0.2)",
                borderColor: "rgba(255, 99, 132, 1)",
                borderWidth: 1,
            }]
        },
        options: {
            responsive: false,
            color: "#ffffff",
            plugins: {
                legend: {
                    labels: {
                        color: "#d5d5d5",
                    },
                },
            },
            scales: {
                yAxes: [{
                    ticks: {
                        color: "#d5d5d5",
                    },
                }],
                xAxes: [{
                    ticks: {
                        color: "#d5d5d5",
                    },
                }],
            },
        },
    })
    `;
	document.body.appendChild(script);

	// messages by data period
	canvas = document.createElement("canvas");
	canvas.id = "messagesByDataPeriod";
	canvas.width = chartSizeX;
	canvas.height = chartSizeY;
	document.body.appendChild(canvas);
	script = document.createElement("script");
	script.innerHTML = `
    const messagesByDataPeriod = document.getElementById("messagesByDataPeriod");
    const messagesByDataPeriodChart = new Chart(messagesByDataPeriod, {
        type: "bar",
        data: {
            labels: dataPeriods.map((period) => period.startDate),
            datasets: [{
                label: "Messages",
                data: dataPeriods.map((period) => period.totalMessages),
                backgroundColor: "rgba(255, 99, 132, 0.2)",
                borderColor: "rgba(255, 99, 132, 1)",
                borderWidth: 1,
            }]
        },
        options: {
            responsive: false,
            color: "#ffffff",
            plugins: {
                legend: {
                    labels: {
                        color: "#d5d5d5",
                    },
                },
            },
            scales: {
                yAxes: [{
                    ticks: {
                        color: "#d5d5d5",
                    },
                }],
                xAxes: [{
                    ticks: {
                        color: "#d5d5d5",
                    },
                }],
            },
        },
    })
    `;
	document.body.appendChild(script);

	let favWords = document.createElement("div");
	let wordList = document.createElement("ol");
	let title = document.createElement("h2");
	title.innerHTML = "Top 10 Words";
	favWords.appendChild(title);
	let wordListItems = [];
	let keys = Object.keys(stats.wordFrequency);
	for (let i = 0; i < 10; i++) {
		wordListItems.push(document.createElement("li"));
		wordListItems[i].innerHTML = `<span class="word">${
			keys[i]
		}:</span><span class="num">${
			stats.wordFrequency[keys[i]].count
		}</span>`;
		wordList.appendChild(wordListItems[i]);
	}
	favWords.appendChild(wordList);
	favWords.classList.add("fav-words");
	document.body.appendChild(favWords);

	let style = document.createElement("style");
	style.innerHTML = `
    * {
        font-family: sans-serif;
        box-sizing: border-box;
        line-height: 1.6;
    }
    body {
        padding: 20px;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(${chartSizeX}px, 1fr));
        grid-gap: 20px;
        background-color: #300050;
        color: white;

    }
    .general-stats {
        grid-row: span 2;
    }
    .fav-words {
        grid-column: span 2;
    }
    .fav-words ol {
        padding: 0;
        margin: 0;
    }
    .fav-words li {
        padding-left: 20px;
        display: flex;
        width: 50%;
    }
    .fav-words li span {
        display: inline-block;
        width: 50%;
    }
    

    `;

	document.head.appendChild(style);

	// build the dom and write it to a file
	console.log("Writing stats.html");
	fs.writeFileSync("stats.html", dom.serialize());
	console.log("Done! Enjoy your stats!");

	if (options.open) {
		openFileInBrowser();
	}
}

function openFileInBrowser() {
	console.log("Opening stats.html in your default browser");
	import("open").then((open) => {
		open.default("stats.html");
	});
}
