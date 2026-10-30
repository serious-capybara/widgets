import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import {warn} from '../../logger.js';

const LRCLIB_URL = 'https://lrclib.net/api/get';
const LRCLIB_SEARCH_URL = 'https://lrclib.net/api/search';
const USER_AGENT = 'Widgets-GNOME-Extension/1.0 (https://github.com/TheRealSourcer/widgets)';
const LYRICS_CACHE_LIMIT = 64;
const LYRICS_CACHE = new Map();
const EMPTY_ENTRY = {synced: false, lines: []};
const LEADING_STAMPS = /^(?:\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+/;
const STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;


export function lyricsKey(artist, title) {
	return `${String(artist ?? '').toLowerCase()}\n${String(title ?? '').toLowerCase()}`;
};

function storeLyrics(key, entry) {
	if (LYRICS_CACHE.size >= LYRICS_CACHE_LIMIT && !LYRICS_CACHE.has(key)) {
		LYRICS_CACHE.delete(LYRICS_CACHE.keys().next().value);
	};

	LYRICS_CACHE.set(key, entry);
};

const OFFSET_TAG = /^\s*\[offset:\s*([+-]?\d+)\s*\]\s*$/i;
const WORD_STAMP = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;

function parseSyncedLyrics(source) {
	const lines = [];
	let offset = 0;

	for (const raw of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
		const tag = raw.match(OFFSET_TAG);

		if (tag) {
			offset = Number(tag[1]);
			continue;
		};

		const lead = raw.match(LEADING_STAMPS);

		if (!lead) continue;

		const text = raw.slice(lead[0].length).replace(WORD_STAMP, '').replace(/\s+/g, ' ').trim();

		for (const stamp of lead[0].matchAll(STAMP)) {
			const fraction = stamp[3] ? Number(stamp[3].padEnd(3, '0').slice(0, 3)) : 0;
			const timeMs = (Number(stamp[1]) * 60 + Number(stamp[2])) * 1000 + fraction;

			lines.push({timeMs: Math.max(0, timeMs - offset), text: text || '\u266a'});
		};
	};

	lines.sort((a, b) => a.timeMs - b.timeMs);

	return lines;
};

function parsePlainLyrics(source) {
	const lines = [];

	for (const raw of source.trim().split(/\r?\n/)) {
		const text = raw.trim();

		if (text === '' && (lines.length === 0 || lines[lines.length - 1].text === '')) continue;

		lines.push({timeMs: null, text});
	};

	return lines;
};

function lyricsFromPayload(payload) {
	const synced = typeof payload?.syncedLyrics === 'string' ? parseSyncedLyrics(payload.syncedLyrics) : [];

	if (synced.length > 0) {
		return {synced: true, lines: synced};
	};

	const plain = typeof payload?.plainLyrics === 'string' ? parsePlainLyrics(payload.plainLyrics) : [];

	return {synced: false, lines: plain};
};

function parseLyricsText(text) {
	try {
		return lyricsFromPayload(JSON.parse(text));
	} catch (error) {
		warn('music-lyrics-parse', `Could not parse lyrics: ${error.message}`);
		return {synced: false, lines: []};
	};
};

function pickLyricsPayload(text, seconds) {
	let list = null;

	try {
		list = JSON.parse(text);
	} catch (error) {
		return {synced: false, lines: []};
	};

	if (!Array.isArray(list)) return {synced: false, lines: []};

	const usable = list.filter(item => (typeof item?.syncedLyrics === 'string' && item.syncedLyrics.trim() !== '')
		|| (typeof item?.plainLyrics === 'string' && item.plainLyrics.trim() !== ''));
	const distance = item => (seconds > 0 && Number.isFinite(item?.duration) ? Math.abs(item.duration - seconds) : 0);

	usable.sort((a, b) => {
		const syncedA = typeof a.syncedLyrics === 'string' && a.syncedLyrics.trim() !== '' ? 0 : 1;
		const syncedB = typeof b.syncedLyrics === 'string' && b.syncedLyrics.trim() !== '' ? 0 : 1;

		return syncedA - syncedB || distance(a) - distance(b);
	});

	return usable.length > 0 ? lyricsFromPayload(usable[0]) : {synced: false, lines: []};
};

export function lyricIndexAt(lines, ms) {
	let low = 0;
	let high = lines.length - 1;
	let found = -1;

	while (low <= high) {
		const mid = (low + high) >> 1;

		if (lines[mid].timeMs <= ms) {
			found = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		};
	};

	return found;
};

export class LyricsProvider {
	constructor() {
		this._session = new Soup.Session({user_agent: USER_AGENT, timeout: 15, idle_timeout: 15});
		this._cancellable = null;
		this._generation = 0;
	};

	cached(artist, title) {
		return LYRICS_CACHE.get(lyricsKey(artist, title));
	};

	cancel() {
		this._generation++;
		this._cancellable?.cancel();
		this._cancellable = null;
	};

	destroy() {
		this.cancel();
		this._session.abort();
	};

	async fetch(artist, title, seconds) {
		this.cancel();

		const generation = this._generation;
		const cancellable = new Gio.Cancellable();
		const stale = () => generation !== this._generation;
		const query = `artist_name=${encodeURIComponent(artist ?? '')}&track_name=${encodeURIComponent(title)}`;
		const getUrl = `${LRCLIB_URL}?${query}${seconds > 0 ? `&duration=${seconds}` : ''}`;
		const searchUrl = `${LRCLIB_SEARCH_URL}?${query}`;
		let entry = EMPTY_ENTRY;
		let reliable = false;

		this._cancellable = cancellable;

		try {
			const direct = await this._request(getUrl, cancellable);

			if (stale()) return null;

			if (direct?.status === 200) {
				entry = parseLyricsText(direct.text);
				reliable = true;
			} else if (direct?.status === 404) {
				reliable = true;
			};

			if (entry.lines.length === 0) {
				const search = await this._request(searchUrl, cancellable);

				if (stale()) return null;

				reliable = search?.status === 200;

				if (reliable) {
					entry = pickLyricsPayload(search.text, seconds);
				};
			};
		} catch (error) {
			if (stale()) return null;

			warn('music-lyrics-fetch', `Could not fetch lyrics: ${error.message}`);
		};

		this._cancellable = null;

		if (reliable) {
			storeLyrics(lyricsKey(artist, title), entry);
		};

		return entry;
	};

	_request(url, cancellable) {
		return new Promise(resolve => {
			const message = Soup.Message.new('GET', url);

			this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (session, result) => {
				try {
					const bytes = session.send_and_read_finish(result);
					const text = new TextDecoder().decode(bytes.get_data() ?? new Uint8Array());

					resolve({status: message.get_status(), text});
				} catch {
					resolve(null);
				};
			});
		});
	};
};
