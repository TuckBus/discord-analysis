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

let profanities = require("./profane.json");
profanities = profanities.map((profanity) => new RegExp(profanity, "gi"));
// Load the zip file
const loadPackage = async () => {
	await zip
		.loadAsync(fs.readFileSync(path.join(__dirname, "data.zip")))
		.then((zip) => {
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
							records = records.filter(
								(record) => record.Contents
							);
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
loadPackage();
// super hacky way to wait for the zip file to be loaded
// but hey at least it works
setTimeout(() => {
	process();
}, 1000);

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
		messagesWithProfanity: 0,
		avgProfanityPerMessage: 0,
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
			stats.messagesWithProfanity++;
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

	stats.avgProfanityPerMessage =
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
	fs.writeFileSync("stats.json", JSON.stringify(stats, null, 4));
	console.log("Done! Enjoy your stats!");
};
