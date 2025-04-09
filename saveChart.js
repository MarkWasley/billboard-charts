import * as cheerio from 'cheerio';
import * as fs from 'fs';
import { DateTime } from 'luxon';

const COUNTRY_SONGS_URL = 'https://www.billboard.com/charts/country-songs/';
const COUNTRY_AIRPLAY_URL = 'https://www.billboard.com/charts/country-airplay/';
const TIMEZONE = 'Pacific/Auckland';

const removeLineFeed = (str) => str.replace(/\n/g, '').replace(/\t/g, '');

const SPOTIFY_API_URL = 'https://api.spotify.com/v1/search';
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

let accessToken;

async function getAccessToken() {
	const tokenURL = "https://accounts.spotify.com/api/token";
	let response = await fetch(tokenURL, {
		method: "POST",
		body: `grant_type=client_credentials&client_id=${SPOTIFY_CLIENT_ID}&client_secret=${SPOTIFY_CLIENT_SECRET}`,
		headers: {
			"Content-Type": "application/x-www-form-urlencoded"
		}
	});
	let json = await response.json();
	return json.access_token;
}

async function fetchSpotifyData(title, artist) {
	try {
		/**
		 * Replaces all curly quotes in a given string with straight quotes.
		 * 
		 * @param {string} strToClean - The string to clean from curly quotes.
		 * @returns {string} - The cleaned string with straight quotes.
		 */
		function removeCurlyQuotes(strToClean) {
			const stringWithStraightQuotes = strToClean.replace(/[\u2018\u2019\u0060\u201C\u201D]/g, (match) => {
				switch (match) {
					case '\u2018':
					case '\u2019':
					case '\u0060':
						return "'"; // Replace curly single quotes with straight single quotes
					case '\u201C':
					case '\u201D':
						return '"'; // Replace curly double quotes with straight double quotes
					default:
						return match;
				}
			});
			return stringWithStraightQuotes;
		}

		function replaceAndOrAmpersand(str) {
			return str.replace(/(&)|and/gi, function (match, isAmpersand) {
				return isAmpersand ? "and" : "&";
			});
		};

		function sortByReleaseDate(a, b) {
			const dateA = new Date(a.album.release_date);
			const dateB = new Date(b.album.release_date);
			return dateA - dateB;
		}

		function cleanNames(name) {
			return name.replace(/[^a-zA-Z0-9\s]/g, '').trim();
		}

		const allowedArtists = [
			"Brooks & Dunn",
			"Hootie & the Blowfish",
			"Maddie & Tae"
		];
		const artistSeparators = [
			", ",
			" feat ",
			" feat. ",
			" featuring ",
			" ft ",
			" ft. ",
			" / ",
			" & ",
			" vs. ",
			"; "
		];

		// If artist contains non-accented characters (i.e. Michael Buble, Celine Dion), fix them for search
		artist = artist.replace(/Buble/g, 'Bublé');
		artist = artist.replace(/Celine Dion/g, 'Céline Dion');
		artist = artist.replace(/Blue Oyster Cult/g, 'Blue Öyster Cult');
		artist = artist.replace(/Beyonce/g, 'Beyoncé');
		artist = artist.replace(/Jose Feliciano/g, 'José Feliciano');
		artist = artist.replace(/\b(Featuring|feat|With)\.?|\s*\/\s*|\s*,\s*/gi, '&');

		let query = `${title} ${artist}`;
		query = removeCurlyQuotes(query);

		let response = await fetch(`${SPOTIFY_API_URL}?q=${encodeURIComponent(query)}&type=track&limit=5`, {
			headers: {
				Authorization: `Bearer ${accessToken}`
			}
		});

		let json = await response.json();
		json.tracks.items.sort(sortByReleaseDate);
		const items = json.tracks.items;

		let finalResult, fallbackResult;

		for (let result of items) {
			let cleanTrackName = removeCurlyQuotes(result.name);
			let artistMatch;

			if (!allowedArtists.some(a => artist.toLowerCase().includes(a.toLowerCase()))) {
				if (artist.includes('&')) {
					artist = artist.split('&')[0].trim();
				}
			} else {
				const allowedArtist = allowedArtists.find(a => artist.toLowerCase().includes(a.toLowerCase()));
				artist = artist.split(allowedArtist)[0].trim();
			}

			if (
				title.toUpperCase() === cleanTrackName.toUpperCase() &&
				(
					result.artists.some(art => art.name.toUpperCase().includes(artist.toUpperCase())) ||
					result.artists.some(art => art.name.toUpperCase().includes(`THE ${artist.toUpperCase()}`)) ||
					result.artists.some(art => art.name.toUpperCase().includes(artist.toUpperCase().replace(/^THE /, '')))
				)
			) {
				if (result.album.album_type === "album") {
					artistMatch = "step1 (album)";
				} else if (!fallbackResult) {
					artistMatch = "step1 (single)";
				}
			}

			const featRegex = /\s*\((f(?:ea)?t(?:uring)?\.?\s.*?|.*?\s?with\s.*?)\)|\s*- Spotify Singles(?: Holiday)?/i;
			const matches = cleanTrackName.match(featRegex);

			if (matches) {
				const newCleanTrackName = cleanTrackName.split(matches[0])[0].trim();
				const featuredArtistBit = matches[0];

				if (
					title.toUpperCase() === newCleanTrackName.toUpperCase() &&
					(
						result.artists.some(art => art.name.toUpperCase().includes(cleanNames(artist).toUpperCase())) ||
						result.artists.some(art => art.name.toUpperCase().includes(`THE ${cleanNames(artist).toUpperCase()}`)) ||
						result.artists.some(art => art.name.toUpperCase().includes(cleanNames(artist).toUpperCase().replace(/^THE /, '')))
					)
				) {
					if (result.album.album_type === "album") {
						artistMatch = "step2 (album)";
					} else if (!fallbackResult) {
						artistMatch = "step2 (single)";
					}
				}
			}

			async function fetchAppleMusicPreview(title, artist, retries = 3, delay = 1000) {
				for (let attempt = 0; attempt < retries; attempt++) {
					let response = await fetch(`https://radio.markwasley.net.nz/lookup/appleMusic.php?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`);
					let json = await response.json();

					if (json && json[0]?.preview_url) {
						return json[0].preview_url;
					}

					if (attempt < retries - 1) {
						await new Promise(res => setTimeout(res, delay));
					}
				}
				return "Not found";
			}

			if (artistMatch) {
				const resultData = {
					artistQueried: artist,
					id: result.id,
					name: result.name,
					artists: result.artists.map(art => art.name),
					album_name: result.album.name,
					type: result.album.album_type,
					artistMatch: artistMatch,
					isrc: result.external_ids.isrc,
					preview: await fetchAppleMusicPreview(cleanTrackName, artist),
				};

				// If album type is "album", set as finalResult and break
				if (result.album.album_type === "album") {
					finalResult = resultData;
					break;
				} else if (!fallbackResult) {
					// If no fallback result has been set yet, set this as the fallback
					fallbackResult = resultData;
				}
			}
		}

		if (!finalResult && fallbackResult) {
			console.log("No final result, using fallback");
			finalResult = fallbackResult;
		}

		if (!finalResult) {
			console.log(`No track found for ${title} by ${artist}`);
			return null;
		}

		return finalResult;
	} catch {
	}
}

async function saveChart(url, date) {
	try {
		const newurl = date ? `${url}${date}` : url;
		const response = await fetch(newurl);
		const html = await response.text();
		const $ = cheerio.load(html);

		const now = DateTime.now().setZone(TIMEZONE);
		const currentDayOfWeek = now.weekday;

		let daysToAdd = 6 - currentDayOfWeek;

		// On Monday and Tuesday, get the date from last Saturday because a new chart hasn't been published yet
		if (currentDayOfWeek <= 2) {
			daysToAdd = -(currentDayOfWeek + 1);
		}

		const chart = {
			date: now.plus({ days: daysToAdd }).startOf('day').toISODate(),
			entries: []
		};

		const processEntries = async () => {
			const elements = $('.o-chart-results-list-row-container');
			for (let index = 0; index < elements.length; index++) {
				const element = elements[index];
				const lastWeekRank = removeLineFeed($('.o-chart-results-list__item:nth-child(4) > span', element).first().text());
				const title = removeLineFeed($(element).find('h3#title-of-a-story').first().text());
				const artist = removeLineFeed($(element).find('h3 + span.c-label').text());
				const rank = index + 1;
				const last_week_rank = lastWeekRank === '-' ? null : Number(lastWeekRank);
				const peakRank = Number(removeLineFeed($(element).find('.o-chart-results-list__item:nth-child(5) > span').first().text()));
				const weeksOnChart = Number(removeLineFeed($(element).find('.o-chart-results-list__item:nth-child(6) > span').first().text()));
				const image = $('img', element).first().attr('data-lazy-src') || null;

				let spotify = {};
				spotify = await fetchSpotifyData(title, artist);

				chart.entries.push({
					name: title,
					artist: artist,
					image: image,
					rank: rank,
					last_week_rank: last_week_rank,
					peak_rank: peakRank,
					weeks_on_chart: weeksOnChart,
					spotify_data: spotify
				});
				console.log(`Pushed entry for ${title} by ${artist}`);
			}
		};

		await processEntries();

		let chartType = 'Country';
		let latestFilePath = 'latest.json';
		let dateFilePathPrefix = '';

		switch (url) {
			case COUNTRY_AIRPLAY_URL:
				chartType = 'Country Airplay';
				latestFilePath = 'latest-airplay.json';
				dateFilePathPrefix = 'airplay-';
				break;
		}

		if (fs.existsSync(latestFilePath)) {
			const existingData = JSON.parse(fs.readFileSync(latestFilePath, 'utf8'));
			fs.renameSync(latestFilePath, `${dateFilePathPrefix}${existingData.date}.json`);
			console.log(`Renaming ${existingData.date} ${chartType} chart to ${dateFilePathPrefix}${existingData.date}.json.`);
		}

		fs.writeFileSync(latestFilePath, JSON.stringify(chart, null, '\t'));
		console.log(`New ${chartType} chart data saved successfully.`);
	} catch (error) {
		console.error(`Error getting chart data from Billboard:`, error);
	}
}

async function main() {
	accessToken = await getAccessToken();

	await saveChart(COUNTRY_SONGS_URL);
	await saveChart(COUNTRY_AIRPLAY_URL);
}

main();