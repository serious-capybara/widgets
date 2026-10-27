import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {surfaceStyle} from '../../utils/widget.js';
import {VERTICAL, boxOrientation, createBlurEffect, setScrollViewChild} from '../../compatibility.js';
import {warn} from '../../logger.js';
import {clipRounded} from '../../utils/roundedClip.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {boundedPosition, formatUs} from './helpers.js';

function mediaColors(theme) {
	return {
		foreground: theme.text ?? (theme.dark ? '#ffffff' : '#241f31'),
		secondary: theme.muted ?? (theme.dark ? '#c0bfbc' : '#5e5c64'),
		backdrop: theme.dark ? 'rgb(30, 33, 42)' : 'rgb(247, 247, 250)',
		tintStart: theme.dark ? 'rgba(26, 32, 44, 0.66)' : 'rgba(255, 255, 255, 0.78)',
		tintEnd: theme.dark ? 'rgba(10, 14, 23, 0.78)' : 'rgba(247, 247, 250, 0.88)',
	};
};

function safeArtworkUri(value) {
	 
	if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || /[\u0000-\u001f\u007f]/u.test(value)) {
		return null;
	};

	try {
		const uri = GLib.Uri.parse(value, GLib.UriFlags.NONE);
		const scheme = uri.get_scheme()?.toLowerCase();

		return ['file', 'http', 'https'].includes(scheme) ? uri.to_string() : null;
	} catch {
		return null;
	};
};

function artworkActor(uri, width, height, styleClass) {
	try {
		const actor = new St.Widget({
			style_class: styleClass,
			style: `background-image: url(${JSON.stringify(uri)});`,
			x_expand: true,
			y_expand: true,
			x_align: Clutter.ActorAlign.FILL,
			y_align: Clutter.ActorAlign.FILL,
		});

		actor.set_size(Math.round(width), Math.round(height));
		if (styleClass === 'widget-music-backdrop-art') {
			actor.x_expand = false;
			actor.y_expand = false;
			actor.opacity = 125;
			actor.add_effect(createBlurEffect({
				brightness: 1,
				radius: Math.max(24, Math.min(44, Math.round(Math.min(width, height) * 0.14))),
				mode: Shell.BlurMode.ACTOR,
			}));
		};
		return actor;
	} catch (error) {
		warn('music-artwork', `Could not load artwork ${uri}: ${error.message}`);
		return null;
	};
};

function replaceActor(parent, current, replacement) {
	if (current) {
		current.destroy();
	};

	if (replacement) {
		parent.insert_child_at_index(replacement, 0);
	};

	return replacement;
};

export function style(theme) {
	const background = theme.dark
		? theme.blur ? 'rgba(18, 20, 27, 0.68)' : 'rgb(18, 20, 27)'
		: theme.background;
	return surfaceStyle(theme, {background, color: mediaColors(theme).foreground});
};

function createControlButton(iconName, iconSize = 18, buttonSize = 32, color = '#ffffff') {
	const icon = new St.Icon({icon_name: iconName, style: `icon-size: ${iconSize}px; color: ${color};`});
	const button = new St.Button({
		style_class: 'widget-music-button',
		can_focus: true,
		reactive: true,
		track_hover: true,
		x_align: Clutter.ActorAlign.CENTER,
		y_align: Clutter.ActorAlign.CENTER,
	});
	icon.x_align = Clutter.ActorAlign.CENTER;
	icon.y_align = Clutter.ActorAlign.CENTER;

	button._iconSize = iconSize;
	button.set_child(icon);
	button.set_size(buttonSize, buttonSize);

	return {button, icon};
};

function recolorIcon(target, color, alpha = 1) {
	target.icon.style = `icon-size: ${target.button._iconSize ?? 18}px; color: ${color};${alpha < 1 ? ` opacity: ${alpha};` : ''}`;
};

export function createCard(theme, createLabel, widgetWidth, widgetHeight, blurredBackground = true) {
	const colors = mediaColors(theme);
	const width = Math.max(120, widgetWidth);
	const height = Math.max(96, widgetHeight);
	const compact = height <= 145;
	const vertical = !compact && (height > width * 1.18 || Math.abs(width - height) < Math.min(width, height) * 0.22);
	const roomy = Math.min(width, height) >= 300;
	const pad = compact ? 12 : roomy ? 20 : 14;
	const gap = compact ? 10 : roomy ? 18 : 12;
	const availableWidth = Math.max(72, width - pad * 2);
	const availableHeight = Math.max(72, height - pad * 2);
	const cover = compact
		? Math.max(52, Math.min(82, availableHeight))
		: vertical
			? Math.max(72, Math.min(roomy ? 184 : 108, availableWidth, availableHeight * (roomy ? 0.52 : 0.43)))
			: Math.max(82, Math.min(150, availableHeight));
	const coverWidth = vertical ? availableWidth : cover;
	const contentWidth = vertical ? availableWidth : Math.max(80, availableWidth - cover - gap);
	const contentHeight = vertical ? Math.max(50, availableHeight - cover - gap) : availableHeight;
	const titleFont = compact ? 16 : roomy ? 22 : 18;
	const artistFont = compact ? 12 : roomy ? 15 : 13;
	const timeFont = roomy ? 12 : 11;
	const barHeight = roomy ? 6 : 5;
	const thumbSize = roomy ? 13 : 11;
	const controlSize = compact ? 29 : roomy ? 36 : 32;
	const playSize = compact ? 34 : roomy ? 44 : 38;
	const showTimeline = !compact && contentHeight >= 100 && contentWidth >= 150;
	const card = {};
	const radius = theme?.radius ?? 26;
	const backdropInset = 48;

	card.container = new St.Widget({
		style_class: theme.dark ? 'widget-music-theme-dark' : 'widget-music-theme-light',
		layout_manager: new Clutter.BinLayout(),
		x_expand: true,
		y_expand: true,
		x_align: Clutter.ActorAlign.FILL,
		y_align: Clutter.ActorAlign.FILL,
		clip_to_allocation: true,
		style: `border-radius: ${radius}px;`,
	});
	card.container.set_size(width - 2, height - 2);
	clipRounded(card.container, radius);

	card.backdrop = new St.Widget({
		style_class: 'widget-music-backdrop',
		layout_manager: new Clutter.FixedLayout(),
		x_expand: true,
		y_expand: true,
		x_align: Clutter.ActorAlign.FILL,
		y_align: Clutter.ActorAlign.FILL,
		clip_to_allocation: true,
		style: `background-color: ${colors.backdrop};`,
	});
	card.backdrop.set_size(width - 2, height - 2);
	clipRounded(card.backdrop, radius, 1);
	card.backdropArt = null;
	card._backgroundEnabled = blurredBackground;

	card.tint = new St.Widget({
		style_class: 'widget-music-tint',
		style: `background-gradient-start: ${colors.tintStart}; background-gradient-end: ${colors.tintEnd};`,
		x_expand: true,
		y_expand: true,
		x_align: Clutter.ActorAlign.FILL,
		y_align: Clutter.ActorAlign.FILL,
	});
	clipRounded(card.tint, radius, 1);

	card.content = new St.BoxLayout({
		...boxOrientation(vertical),
		x_expand: true,
		y_expand: true,
		x_align: vertical ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.FILL,
		y_align: Clutter.ActorAlign.CENTER,
		style: `spacing: ${gap}px; padding: ${pad}px;`,
	});
	card.container.add_child(card.backdrop);
	card.container.add_child(card.tint);
	card.container.add_child(card.content);

	const coverRadius = Math.max(10, Math.round(cover * 0.11));

	card.coverBox = new St.Widget({
		layout_manager: new Clutter.BinLayout(),
		style_class: 'widget-music-cover-box',
		style: `border-radius: ${coverRadius}px;`,
		clip_to_allocation: true,
	});
	card.coverBox.set_size(coverWidth, cover);
	clipRounded(card.coverBox, coverRadius);
	card.coverBox.x_expand = false;
	card.coverBox.y_expand = false;
	card.coverArt = null;

	card.cover = new St.Icon({
		style_class: 'widget-music-cover',
		icon_name: 'audio-x-generic-symbolic',
		x_align: Clutter.ActorAlign.CENTER,
		y_align: Clutter.ActorAlign.CENTER,
		style: `icon-size: ${Math.round(cover * 0.36)}px; color: ${colors.secondary};`,
	});
	card.cover.set_size(coverWidth, cover);
	card.coverBox.add_child(card.cover);

	card.refreshArtwork = function () {
		const uri = card._artUri;
		const coverActor = uri ? artworkActor(uri, coverWidth, cover, 'widget-music-cover-art') : null;
		if (coverActor) {
			clipRounded(coverActor, coverRadius, 1);
		};
		const backdropActor = uri && card._backgroundEnabled
			? artworkActor(uri, width + backdropInset * 2, height + backdropInset * 2, 'widget-music-backdrop-art')
			: null;
		backdropActor?.set_position(-backdropInset, -backdropInset);

		card.coverArt = replaceActor(card.coverBox, card.coverArt, coverActor);
		card.backdropArt = replaceActor(card.backdrop, card.backdropArt, backdropActor);
		card.cover.visible = !card.coverArt;
		card.backdrop.visible = Boolean(card.backdropArt);
		card.tint.visible = Boolean(card.backdropArt);
	};

	card.showArt = function (artUrl) {
		const uri = safeArtworkUri(artUrl);

		if (uri === card._artUri) return;

		card._artUri = uri;
		card.refreshArtwork();
	};

	card.setBlurredBackground = function (enabled) {
		const next = Boolean(enabled);

		if (next === card._backgroundEnabled) return;

		card._backgroundEnabled = next;
		card.refreshArtwork();
	};

	card.column = new St.BoxLayout({
		...VERTICAL,
		width: contentWidth,
		x_expand: true,
		x_align: Clutter.ActorAlign.FILL,
		y_align: Clutter.ActorAlign.CENTER,
		clip_to_allocation: true,
		style: `spacing: ${roomy ? 6 : 4}px;`,
	});

	card.title = createLabel('', 'widget-music-title', `font-size: ${titleFont}px; color: ${colors.foreground};`);
	card.title.clutter_text.single_line_mode = true;
	card.title.clutter_text.ellipsize = Pango.EllipsizeMode.END;

	card.artist = createLabel('', 'widget-music-artist', `font-size: ${artistFont}px; color: ${colors.secondary};`);
	card.artist.clutter_text.single_line_mode = true;
	card.artist.clutter_text.ellipsize = Pango.EllipsizeMode.END;

	card.times = new St.BoxLayout({
		x_expand: true,
		style_class: 'widget-music-times',
	});

	card.timeElapsed = createLabel('0:00', 'widget-music-time', `font-size: ${timeFont}px; color: ${colors.secondary};`);
	card.timeElapsed.x_align = Clutter.ActorAlign.START;
	card.timeTotal = createLabel('0:00', 'widget-music-time', `font-size: ${timeFont}px; color: ${colors.secondary};`);
	card.timeTotal.x_align = Clutter.ActorAlign.END;

	card._contentWidth = contentWidth;
	card._lastLength = 0;

	card.slider = new St.Button({
		style_class: 'widget-music-slider',
		can_focus: true,
		reactive: true,
		x_expand: true,
		track_hover: true,
	});
	card.slider.set_width(contentWidth);
	card.slider.set_height(barHeight + 12);

	card.track = new St.Widget({
		style_class: 'widget-music-track',
		width: contentWidth - 6,
		style: `border-radius: ${barHeight / 2}px; min-height: ${barHeight}px; height: ${barHeight}px;`,
	});
	card.fill = new St.Widget({
		style_class: 'widget-music-fill',
		style: `background-color: ${theme.accent}; border-radius: ${barHeight / 2}px;`,
	});
	card.fill.set_size(0, barHeight);
	card.thumb = new St.Widget({
		style_class: 'widget-music-thumb',
		style: `width: ${thumbSize}px; height: ${thumbSize}px; border-radius: ${Math.round(thumbSize / 2)}px; background-color: ${theme.accent};`,
	});
	card.thumb.set_position(0, Math.round((barHeight - thumbSize) / 2));
	card.track.add_child(card.fill);
	card.track.add_child(card.thumb);
	card.slider.set_child(card.track);

	card.fractionForEvent = function (event) {
		const [stageX] = event.get_coords();
		const [trackX] = card.track.get_transformed_position();
		const [trackWidth] = card.track.get_transformed_size();

		if (trackWidth <= 0) {
			const fallbackWidth = card._contentWidth || card.slider.get_width() || 300;
			const fallbackTrackX = card.slider.get_transformed_position()[0];
			const fraction = (stageX - fallbackTrackX) / fallbackWidth;
			return fraction >= 0 && fraction <= 1 ? fraction : null;
		};

		const fraction = (stageX - trackX) / trackWidth;
		return fraction >= 0 && fraction <= 1 ? fraction : null;
	};

	card.preview = function (fraction) {
		const f = Math.max(0, Math.min(1, fraction ?? 0));
		const length = card._lastLength || 0;
		const trackWidth = card.track.get_width() > 0 ? card.track.get_width() : card._contentWidth;
		const fillWidth = Math.max(0, Math.min(trackWidth, Math.round(trackWidth * f)));

		card.timeElapsed.text = formatUs(Math.round(length * f));
		card.fill.set_size(fillWidth, barHeight);

		const maxThumbX = trackWidth - thumbSize / 2;
		const thumbX = Math.max(thumbSize / 2, Math.min(maxThumbX, fillWidth));
		card.thumb.set_position(Math.round(thumbX - thumbSize / 2), Math.round((barHeight - thumbSize) / 2));
	};

	card.controls = new St.BoxLayout({
		x_expand: true,
		x_align: Clutter.ActorAlign.FILL,
		style: `spacing: ${roomy ? 7 : 4}px;`,
	});

	card.btnLoop = createControlButton('media-playlist-repeat-symbolic', compact ? 16 : 18, controlSize, colors.foreground);
	card.btnPrev = createControlButton('media-skip-backward-symbolic', compact ? 17 : 19, controlSize, colors.foreground);
	card.btnPlay = createControlButton('media-playback-start-symbolic', roomy ? 24 : 21, playSize, colors.foreground);
	card.btnPlay.button.add_style_class_name('widget-music-button-primary');
	card.btnNext = createControlButton('media-skip-forward-symbolic', compact ? 17 : 19, controlSize, colors.foreground);
	card.btnLyrics = createControlButton('folder-music-symbolic', compact ? 16 : 18, controlSize, colors.foreground);

	const controlsStart = new St.Widget({x_expand: true, style_class: 'widget-music-controls-spacer'});
	const controlsEnd = new St.Widget({x_expand: true, style_class: 'widget-music-controls-spacer'});

	card.controls.add_child(controlsStart);
	card.controls.add_child(card.btnLoop.button);
	card.controls.add_child(card.btnPrev.button);
	card.controls.add_child(card.btnPlay.button);
	card.controls.add_child(card.btnNext.button);
	card.controls.add_child(card.btnLyrics.button);
	card.controls.add_child(controlsEnd);

	card.times.add_child(card.timeElapsed);
	card.times.add_child(card.timeTotal);
	card.column.add_child(card.title);
	card.column.add_child(card.artist);
	card.column.add_child(card.slider);
	card.column.add_child(card.times);
	card.column.add_child(card.controls);
	card.content.add_child(card.coverBox);
	card.content.add_child(card.column);

	if (!showTimeline) {
		card.slider.hide();
		card.times.hide();
	};

	const lyricFont = compact ? 10 : roomy ? 15 : 12;
	const backSize = compact ? 26 : 28;
	const footerFont = compact ? 9 : 10;
	const lyricsGap = compact ? 4 : 6;
	const footerHeight = footerFont + 6;
	const lyricLineHeight = Math.round(lyricFont * 1.35);
	const lyricsSpacing = compact ? 3 : 5;

	card.lyricsView = new St.BoxLayout({
		...VERTICAL,
		style_class: 'widget-music-lyrics-container',
		x_expand: true,
		y_expand: true,
		x_align: Clutter.ActorAlign.FILL,
		y_align: Clutter.ActorAlign.FILL,
		clip_to_allocation: true,
		visible: false,
		style: `spacing: ${lyricsGap}px; padding: ${pad}px;`,
	});
	card.lyricsView.set_size(width - 2, height - 2);

	card.lyricsHeader = new St.BoxLayout({
		x_expand: true,
		y_expand: false,
		x_align: Clutter.ActorAlign.FILL,
		y_align: Clutter.ActorAlign.START,
		style: 'spacing: 8px;',
	});
	card.lyricsHeader.set_height(backSize);

	card.btnBack = createControlButton('pan-end-symbolic-rtl', compact ? 14 : 16, backSize, colors.foreground);
	card.btnBack.button.add_style_class_name('widget-music-lyrics-back-button');
	card.btnBack.button.x_align = Clutter.ActorAlign.START;
	card.btnBack.button.y_align = Clutter.ActorAlign.CENTER;

	card.lyricsTitle = createLabel('', 'widget-music-lyrics-title', `font-size: ${artistFont}px; color: ${colors.foreground};`);
	card.lyricsTitle.x_expand = true;
	card.lyricsTitle.y_align = Clutter.ActorAlign.CENTER;
	card.lyricsTitle.clutter_text.single_line_mode = true;
	card.lyricsTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;

	card.lyricsScroll = new St.ScrollView({
		style_class: 'widget-music-lyrics-scroll',
		hscrollbar_policy: St.PolicyType.NEVER,
		vscrollbar_policy: St.PolicyType.AUTOMATIC,
		overlay_scrollbars: true,
		x_expand: true,
		y_expand: true,
		x_align: Clutter.ActorAlign.FILL,
		y_align: Clutter.ActorAlign.FILL,
		clip_to_allocation: true,
	});

	card.lyricsList = new St.BoxLayout({
		...VERTICAL,
		x_expand: true,
		x_align: Clutter.ActorAlign.FILL,
		style: `spacing: ${lyricsSpacing}px; padding: 4px;`,
	});
	setScrollViewChild(card.lyricsScroll, card.lyricsList);

	card.lyricsFooter = createLabel(_('Lyrics provided by LRCLIB (lrclib.net)'), 'widget-music-lyrics-footer', `font-size: ${footerFont}px; color: ${colors.secondary};`);
	card.lyricsFooter.x_align = Clutter.ActorAlign.CENTER;
	card.lyricsFooter.y_expand = false;
	card.lyricsFooter.set_height(footerHeight);
	card.lyricsFooter.y_align = Clutter.ActorAlign.END;
	card.lyricsFooter.clutter_text.single_line_mode = true;
	card.lyricsFooter.clutter_text.ellipsize = Pango.EllipsizeMode.END;

	card.lyricsHeader.add_child(card.btnBack.button);
	card.lyricsHeader.add_child(card.lyricsTitle);
	card.lyricsView.add_child(card.lyricsHeader);
	card.lyricsView.add_child(card.lyricsScroll);
	card.lyricsView.add_child(card.lyricsFooter);
	card.container.add_child(card.lyricsView);

	card.lyricsLines = [];
	card._lyricsMode = false;
	card._activeLyric = -1;
	card._centerPending = true;

	const styleLyric = (button, label, active) => {
		if (active) {
			label.style = `font-size: ${lyricFont + 2}px; color: #ffffff; font-weight: 800; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);`;
			button.add_style_class_name('widget-music-lyric-active');
			label.add_style_class_name('widget-music-lyric-active');
		} else {
			label.style = `font-size: ${lyricFont}px; color: ${colors.secondary}; font-weight: 500; opacity: 0.7;`;
			button.remove_style_class_name('widget-music-lyric-active');
			label.remove_style_class_name('widget-music-lyric-active');
		};
	};

	const createLyricLine = (text, index) => {
		const button = new St.Button({
			style_class: 'widget-music-lyric-button',
			can_focus: true,
			reactive: true,
			track_hover: true,
			x_expand: true,
			y_expand: false,
			x_align: Clutter.ActorAlign.FILL,
			y_align: Clutter.ActorAlign.CENTER,
		});

		const label = new St.Label({
			style_class: 'widget-music-lyric-line',
			text,
			x_expand: true,
			y_expand: false,
			x_align: Clutter.ActorAlign.FILL,
			reactive: false,
		});

		label.clutter_text.line_wrap = true;
		label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
		label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
		label.clutter_text.line_alignment = Pango.Alignment.CENTER;

		button.set_child(label);

		const triggerClick = () => {
			if (typeof card._onLyricClicked === 'function') {
				card._onLyricClicked(index);
			};
		};

		button.connect('clicked', triggerClick);
		button.connect('button-release-event', (_source, event) => {
			if (event.get_button() === 1) {
				triggerClick();
				return Clutter.EVENT_STOP;
			};
			return Clutter.EVENT_PROPAGATE;
		});

		styleLyric(button, label, false);

		return button;
	};

	card.lyricsAdjustment = function () {
		const scroll = card.lyricsScroll;

		return 'get_vadjustment' in scroll ? scroll.get_vadjustment() : scroll.get_vscroll_bar().get_adjustment();
	};

	card.setLyrics = function (texts, centered = false) {
		card.lyricsList.destroy_all_children();
		card.lyricsLines = [];
		card._activeLyric = -1;
		card._centerPending = true;

		const padV = centered ? 24 : compact ? 20 : 28;
		card.lyricsList.style = `spacing: ${lyricsSpacing}px; padding: ${padV}px 4px;`;

		for (let i = 0; i < texts.length; i++) {
			const line = createLyricLine(texts[i], i);

			card.lyricsList.add_child(line);
			card.lyricsLines.push(line);
		};

		const adjustment = card.lyricsAdjustment();

		if (adjustment) {
			adjustment.value = 0;
		};
	};

	card.setLyricsMessage = function (kind) {
		card.setLyrics([kind === 'loading' ? _('Loading lyrics…') : _('No lyrics found')], true);
	};

	card.centerLyric = function () {
		const adjustment = card.lyricsAdjustment();

		if (!adjustment || adjustment.page_size <= 0) {
			card._centerPending = true;
			return;
		};

		const line = card.lyricsLines[card._activeLyric];
		let target = 0;

		if (line) {
			const box = line.get_allocation_box();

			if (box.y2 <= box.y1) {
				card._centerPending = true;
				if (!card._retryCenterId) {
					card._retryCenterId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
						card._retryCenterId = 0;
						if (card._lyricsMode) card.centerLyric();
						return GLib.SOURCE_REMOVE;
					});
				};
				return;
			};

			const lineCenter = (box.y1 + box.y2) / 2;
			target = lineCenter - adjustment.page_size / 2;

			target = Math.min(target, box.y1 - 18);
		};

		target = Math.max(0, Math.min(target, Math.max(0, adjustment.upper - adjustment.page_size)));

		const snap = card._centerPending;

		card._centerPending = false;

		if (snap || typeof adjustment.ease !== 'function') {
			adjustment.value = target;
		} else {
			adjustment.ease(target, {duration: 300, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
		};
	};

	card.setActiveLyric = function (index) {
		const changed = index !== card._activeLyric;

		if (!changed && !card._centerPending) return;

		if (changed) {
			const previous = card.lyricsLines[card._activeLyric];
			const next = card.lyricsLines[index];

			if (previous) {
				const prevLabel = previous.get_child?.() ?? previous;
				styleLyric(previous, prevLabel, false);
			};

			if (next) {
				const nextLabel = next.get_child?.() ?? next;
				styleLyric(next, nextLabel, true);
			};

			card._activeLyric = index;
		};

		if (card._lyricsMode) {
			card.centerLyric();
		};
	};

	card.setLyricsMode = function (enabled) {
		const next = Boolean(enabled);

		if (next === card._lyricsMode) return;

		card._lyricsMode = next;
		card.content.visible = !next;
		card.lyricsView.visible = next;

		if (next) {
			card.lyricsView.queue_relayout();
			card._centerPending = true;
			card.centerLyric();
		};
	};

	card.update = function ({
		title, artist, artUrl, playing, position, length, canControl, canPrev, canNext, canPlay, canPause,
		loop = 'None', canSeek = false, seekPreview = false, loopSupported = true, forcePrev = false, forceNext = false,
	}) {
		const hasTrack = Boolean(title && title.length > 0);
		const control = canControl !== false || canPlay || canPause || canPrev || canNext || canSeek;

		if (hasTrack) {
			card.title.text = title;
			card.artist.text = artist || _('Unknown artist');
			card.showArt(artUrl);
		} else {
			card.title.text = _('Nothing playing');
			card.artist.text = _('Start playback in a media app');
			card.showArt(null);
			card.timeElapsed.text = '0:00';
			card.timeTotal.text = '0:00';
			card.fill.set_size(0, barHeight);
			card.thumb.set_position(0, Math.round((barHeight - thumbSize) / 2));
			card.thumb.opacity = 0;
		};

		const displayLength = hasTrack ? length : 0;
		const displayPosition = boundedPosition(position, displayLength);
		card._lastLength = displayLength;
		card.timeTotal.text = displayLength > 0 ? formatUs(displayLength) : '0:00';

		if (!seekPreview) {
			card.timeElapsed.text = hasTrack ? formatUs(displayPosition) : '0:00';

			const fraction = displayLength > 0 ? displayPosition / displayLength : 0;
			const trackWidth = card.track.get_width() > 0 ? card.track.get_width() : contentWidth;
			const maxFillWidth = trackWidth;
			const fillWidth = Math.max(0, Math.min(maxFillWidth, Math.round(trackWidth * fraction)));

			card.fill.set_size(fillWidth, barHeight);

			const maxThumbX = trackWidth - thumbSize / 2;
			const minThumbX = thumbSize / 2;
			const thumbX = Math.max(minThumbX, Math.min(maxThumbX, fillWidth));
			card.thumb.set_position(Math.round(thumbX - thumbSize / 2), Math.round((barHeight - thumbSize) / 2));
			card.thumb.opacity = hasTrack && displayLength > 0 ? 255 : 0;
		};

		const loopOk = loopSupported !== false;

		card.btnLoop.button.reactive = control && loopOk;
		card.btnLoop.button.opacity = loopOk ? (control ? 255 : 100) : 30;
		card.btnPrev.button.reactive = control && (!!canPrev || forcePrev);
		card.btnPrev.button.opacity = control && (canPrev || forcePrev) ? 255 : 100;
		card.btnPlay.button.reactive = control && (playing ? !!canPause : !!canPlay);
		card.btnPlay.button.opacity = control && (playing ? canPause : canPlay) ? 255 : 100;
		card.btnNext.button.reactive = control && (!!canNext || forceNext);
		card.btnNext.button.opacity = control && (canNext || forceNext) ? 255 : 100;

		card.lyricsTitle.text = hasTrack ? title : '';
		card.btnLyrics.button.reactive = hasTrack;
		card.btnLyrics.button.opacity = hasTrack ? 255 : 100;
		recolorIcon(card.btnLyrics, colors.foreground);

		if (!hasTrack && card._lyricsMode) {
			card.setLyricsMode(false);
		};

		const seekable = hasTrack && control && (length > 0 || playing) && (canSeek || canPlay || canPause);
		card.slider.reactive = seekable;
		card.slider.opacity = seekable ? 255 : 90;

		card.btnPlay.icon.icon_name = playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';

		recolorIcon(card.btnPlay, colors.foreground);
		recolorIcon(card.btnLoop, control ? colors.foreground : colors.secondary, control ? 1 : 0.4);
		recolorIcon(card.btnPrev, colors.foreground);
		recolorIcon(card.btnNext, colors.foreground);

		if (loop === 'Track') {
			card.btnLoop.icon.icon_name = 'media-playlist-repeat-song-symbolic';
			recolorIcon(card.btnLoop, theme.accent);
			card.btnLoop.button.add_style_pseudo_class('checked');
		} else if (loop === 'Playlist') {
			card.btnLoop.icon.icon_name = 'media-playlist-repeat-symbolic';
			recolorIcon(card.btnLoop, theme.accent);
			card.btnLoop.button.add_style_pseudo_class('checked');
		} else {
			card.btnLoop.icon.icon_name = 'media-playlist-repeat-symbolic';
			recolorIcon(card.btnLoop, control ? colors.foreground : colors.secondary, control ? 1 : 0.4);
			card.btnLoop.button.remove_style_pseudo_class('checked');
		};
	};

	card.update({title: null, artist: null, artUrl: null, playing: false, position: 0, length: 0,
		canControl: false, canPrev: false, canNext: false, canPlay: false, canPause: false, loop: 'None', canSeek: false});

	return card;
};
