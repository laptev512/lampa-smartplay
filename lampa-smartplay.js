/* Lampa SmartPlay 0.1.1 - quality and available voice preference.
 * No stream discovery, DRM bypass or provider API calls.
 * Compatible with Lampa.Player.play / playlist and Lampac playback objects.
 */
(function () {
  'use strict';
  if (window.__lampa_smartplay) return;
  window.__lampa_smartplay = true;

  var S = Lampa.Storage;
  var PREFIX = 'smartplay_';
  var originalPlay = null;
  var originalPlaylist = null;
  var lastSelection = null;
  var initialized = false;

  function get(key, def) { try { return S.get(PREFIX + key, def); } catch (e) { return def; } }
  function on() { var v = get('enabled', true); return v !== false && v !== 'false' && v !== '0'; }
  function norm(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''); }
  function qualityNum(value) {
    var v = String(value || '');
    if (/\b(4k|uhd)\b/i.test(v)) return 2160;
    if (/\b(8k)\b/i.test(v)) return 4320;
    var match = v.match(/(?:^|\D)(2160|1440|1080|720|576|540|480|360|240)(?:p|\b)/i);
    return match ? parseInt(match[1], 10) : 0;
  }
  function maxQuality() {
    var value = get('max_quality', '2160');
    return value === '0' ? 99999 : parseInt(value, 10) || 2160;
  }
  function validUrl(url) {
    // Only already supplied, playable HTTP(S) links. Do not resolve provider tokens or links.
    return typeof url === 'string' && /^https?:\/\/[^\s]+$/i.test(url);
  }
  function variants(q) {
    var result = [], key, el;
    if (!q) return result;
    if (Object.prototype.toString.call(q) === '[object Array]') {
      for (var i = 0; i < q.length; i++) {
        el = q[i];
        if (el && validUrl(el.url || el.file)) result.push({ label: el.quality || el.title || el.name || '', url: el.url || el.file });
      }
    } else if (typeof q === 'object') {
      for (key in q) if (Object.prototype.hasOwnProperty.call(q, key)) {
        el = q[key];
        if (validUrl(el)) result.push({ label: key, url: el });
        else if (el && validUrl(el.url || el.file)) result.push({ label: key, url: el.url || el.file });
      }
    }
    return result;
  }
  function chooseQuality(q) {
    var list = variants(q), cap = maxQuality(), mode = get('quality_mode', 'max'), found = null, i, n, points, best = -1e9;
    for (i = 0; i < list.length; i++) {
      n = qualityNum(list[i].label);
      // Do not select unknown or out-of-cap resolutions in strict mode.
      if (!n || n > cap) continue;
      points = mode === 'balanced' ? -Math.abs(n - Math.min(cap, 1080)) : n;
      if (points > best) { best = points; found = list[i]; }
    }
    return found;
  }
  function pickVoice(list, current) {
    var preferred = norm(get('voice_preference', ''));
    if (!preferred || !list || !list.length) return current;
    var baseSeason = current.season, baseEpisode = current.episode;
    var candidates = [], i, item, voice;
    for (i = 0; i < list.length; i++) {
      item = list[i];
      if (!item || !validUrl(item.url)) continue;
      // Never jump to a different episode; undefined seasons/episodes must match too.
      if (String(item.season || '') !== String(baseSeason || '') || String(item.episode || '') !== String(baseEpisode || '')) continue;
      voice = norm(item.voice_name || item.translate_voice || item.audio || '');
      if (voice && voice.indexOf(preferred) !== -1) candidates.push(item);
    }
    return candidates.length ? candidates[0] : current;
  }
  function prepare(item) {
    if (!on() || !item || typeof item !== 'object' || !validUrl(item.url)) return item;
    var chosen = chooseQuality(item.quality);
    if (!chosen || chosen.url === item.url) return item;
    var out = {};
    for (var k in item) if (Object.prototype.hasOwnProperty.call(item, k)) out[k] = item[k];
    out.url = chosen.url;
    // Keep item.quality: preserves Lampa player quality selector.
    lastSelection = { quality: chosen.label, voice: out.voice_name || '' };
    return out;
  }
  function installPlayer() {
    if (!Lampa.Player || typeof Lampa.Player.play !== 'function') return false;
    if (!originalPlay) originalPlay = Lampa.Player.play;
    if (!originalPlaylist && typeof Lampa.Player.playlist === 'function') originalPlaylist = Lampa.Player.playlist;
    if (Lampa.Player.play.__smartplay_wrapper) return true;
    var wrapped = function (item) {
      var source = item;
      if (on() && item && typeof item === 'object' && validUrl(item.url) && item.playlist && Object.prototype.toString.call(item.playlist) === '[object Array]') {
        source = pickVoice(item.playlist, item);
      }
      var updated = prepare(source);
      return originalPlay.call(this, updated);
    };
    wrapped.__smartplay_wrapper = true;
    Lampa.Player.play = wrapped;
    return true;
  }
  function status() {
    return 'SmartPlay 0.1.1: ' + (on() ? 'включён' : 'выключен') + '. ' +
      'Потолок: ' + (maxQuality() === 99999 ? 'без ограничения' : maxQuality() + 'p') +
      ', озвучка: ' + (get('voice_preference', '') || 'как выбрал источник');
  }
  function settings() {
    if (!Lampa.SettingsApi || typeof Lampa.SettingsApi.addComponent !== 'function') return;
    Lampa.SettingsApi.addComponent({ component: 'smartplay', name: 'SmartPlay', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' });
    function add(key, type, name, description, values, def) {
      var param = { name: PREFIX + key, type: type, 'default': def };
      if (values !== null && typeof values !== 'undefined') param.values = values;
      if (type === 'input') param.placeholder = 'Например: LostFilm';
      Lampa.SettingsApi.addParam({ component: 'smartplay', param: param, field: { name: name, description: description } });
    }
    add('enabled', 'trigger', 'Включить SmartPlay', 'Применять предпочтения при запуске воспроизведения', null, true);
    add('max_quality', 'select', 'Максимальное разрешение', 'Поток выше указанного разрешения автоматически не выбирается', {
      '0': 'Без ограничения', '2160': '4K / 2160p', '1440': '1440p', '1080': '1080p', '720': '720p', '480': '480p'
    }, '2160');
    add('quality_mode', 'select', 'Приоритет качества', 'Максимум — наивысшее доступное до потолка; баланс — ближе к 1080p', {
      max: 'Максимальное качество', balanced: 'Сбалансированное (до 1080p)'
    }, 'max');
    add('voice_preference', 'input', 'Предпочтение озвучки', 'Часть имени дорожки/перевода. Сработает, если варианты переданы в плейлисте для той же серии.', '', '');
    // Do not create an incomplete 'static' param: some Lampa builds crash when rendering it.
  }
  function init() {
    if (initialized) return;
    initialized = true;
    settings();
    installPlayer();
    // Third-party plugins may replace the player method later: retry for a short period.
    var attempts = 0, timer = setInterval(function () {
      attempts++;
      installPlayer();
      if (attempts >= 30) clearInterval(timer);
    }, 2000);
  }
  window.LampaSmartPlay = { version: '0.1.1', qualityNum: qualityNum, chooseQuality: chooseQuality, pickVoice: pickVoice, prepare: prepare, status: status };
  if (window.appready) init();
  else if (Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
    Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') init(); });
  } else init();
})();
