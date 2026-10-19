import {
  wordKey, getRecord, getAllRecords, putRecord, patchWordState, setNote,
  exportBackup, importBackup, migrateSameOriginV4,
} from './db.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const APP_BASE = new URL('./', import.meta.url);
const assetUrl = (value) => new URL(String(value || '').replace(/^\/+/, ''), APP_BASE).href;
const cacheStorageAvailable = () => typeof caches !== 'undefined' && typeof caches.open === 'function';
const shuffle = (items) => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const flattenMeaning = (entry, limit = 5) => (entry?.s || []).flatMap((sense) => sense.z || []).slice(0, limit).join('；');

const els = {
  loading: $('#loadingView'), loadingText: $('#loadingText'),
  chapter: $('#chapterSelect'), progress: $('#progressText'), correct: $('#correctText'), wrong: $('#wrongText'),
  prompt: $('#promptText'), slots: $('#letterSlots'), input: $('#answerInput'), result: $('#resultText'), answer: $('#answerPanel'),
  submit: $('#submitBtn'), star: $('#starBtn'), replay: $('#replayBtn'), restart: $('#restartBtn'), promptAudio: $('#promptAudioBtn'), studyCard: $('#studyCard'),
  wrongCount: $('#wrongBookCount'), starCount: $('#starBookCount'), wrongTabCount: $('#wrongTabCount'), starTabCount: $('#starTabCount'),
  overviewTitle: $('#overviewTitle'), overviewSearch: $('#overviewSearch'), overviewList: $('#overviewList'),
  dictSearch: $('#dictionarySearch'), dictList: $('#dictionaryList'), dictSummary: $('#dictionarySummary'),
  dictAlphabet: $('#dictionaryAlphabet'), dictSentinel: $('#dictionarySentinel'), dictEyebrow: $('#dictionaryEyebrow'),
  bookList: $('#bookList'), startBookReview: $('#startBookReview'),
  overlay: $('#detailOverlay'), sheet: $('#detailSheet'), detailScroll: $('#detailScroll'), detail: $('#detailContent'), swipeCue: $('#detailSwipeCue'),
  lookupOverlay: $('#lookupOverlay'), lookupCard: $('#lookupCard'), lookup: $('#lookupContent'),
  toast: $('#toast'), audioProgress: $('#audioProgress'), offlineStatus: $('#offlineStatus'),
  syncBadge: $('#syncBadge'), install: $('#installBtn'),
};

const state = {
  studyData: null,
  dictionary: null,
  audioIndex: { entries: {}, shards: [], totalBytes: 0 },
  exampleAudioUS: {},
  dictionaryMap: new Map(),
  coreMap: new Map(),
  coreByLegacyId: new Map(),
  wordStates: new Map(),
  chapterId: 1,
  sequence: [],
  index: 0,
  correct: 0,
  wrong: 0,
  showChinese: true,
  autoAudio: true,
  randomOrder: false,
  sequenceKeys: [],
  answered: false,
  correctionRequired: false,
  reviewMode: false,
  reviewBook: 'wrong',
  activeBook: 'wrong',
  overviewOrder: 'original',
  dictionaryFilter: 'all',
  dictionaryLetter: 'all',
  dictionaryMatches: [],
  dictionaryRendered: 0,
  dictionaryBatch: 100,
  dictionaryObserver: null,
  detailSequence: [],
  detailIndex: -1,
  detailSource: null,
  detailTrail: [],
  detailBrowserDepth: -1,
  detailSessionActive: false,
  detailClosing: false,
  quickLookup: null,
  quickLookupActive: false,
  accent: 'uk',
  audio: null,
  audioObjectUrl: '',
  audioClipCache: new Map(),
  audioPackDownload: null,
};

let dictionaryLoadPromise = null;
let audioMetadataLoadPromise = null;

const optionalJson = (path, fallback) => fetch(assetUrl(path))
  .then((response) => response.ok ? response.json() : fallback)
  .catch(() => fallback);

async function ensureDictionaryLoaded() {
  if (state.dictionary) return state.dictionary;
  if (dictionaryLoadPromise) return dictionaryLoadPromise;
  els.dictEyebrow.textContent = '正在载入完整词典…';
  dictionaryLoadPromise = fetch(assetUrl('data/dictionary-v2.json'))
    .then((response) => {
      if (!response.ok) throw new Error(`词典 HTTP ${response.status}`);
      return response.json();
    })
    .then((dictionary) => {
      state.dictionary = dictionary;
      state.dictionaryMap.clear();
      for (const entry of dictionary.entries || []) state.dictionaryMap.set(entry.w, entry);
      els.dictEyebrow.textContent = `${Number(dictionary.count || dictionary.entries?.length || 0).toLocaleString()} 词 · 开放词典`;
      return dictionary;
    })
    .catch((error) => {
      dictionaryLoadPromise = null;
      els.dictEyebrow.textContent = '词典载入失败，点击“词典”重试';
      throw error;
    });
  return dictionaryLoadPromise;
}

async function ensureAudioMetadataLoaded() {
  if (state.audioIndex.shards?.length) return state.audioIndex;
  if (audioMetadataLoadPromise) return audioMetadataLoadPromise;
  audioMetadataLoadPromise = Promise.all([
    optionalJson('data/audio-index-v7.json', { entries: {}, shards: [], totalBytes: 0 }),
    optionalJson('data/example-audio-v7.json', { entries: {} }),
  ]).then(([audioIndex, exampleAudio]) => {
    state.audioIndex = audioIndex;
    state.exampleAudioUS = exampleAudio.entries || {};
    if (audioIndex.totalBytes) {
      const size = (audioIndex.totalBytes / 1024 / 1024 / 1024).toFixed(2);
      els.offlineStatus.textContent = `完整英美双音包约 ${size} GB；支持中断后继续。`;
      $('#downloadCoreAudio').textContent = `下载完整英美双音包（约 ${size} GB）`;
    }
    return audioIndex;
  });
  return audioMetadataLoadPromise;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove('show'), 2300);
}

function currentWord() { return state.sequence[state.index] || null; }
function currentChapter() {
  if (state.chapterId === 0) return { id: 0, title: '全部单词', displayTitle: `🎲 全部单词（${state.studyData.totalWords}）`, words: [...state.coreMap.values()] };
  if (state.chapterId === state.studyData.extraChapter.id) return state.studyData.extraChapter;
  return state.studyData.chapters.find((chapter) => chapter.id === state.chapterId) || state.studyData.chapters[0];
}

function dictionaryRecord(raw) {
  let query = wordKey(raw).replace(/[’‘]/g, "'").replace(/^[^a-z]+|[^a-z]+$/g, '');
  if (!query) return null;
  const direct = state.dictionaryMap.get(query);
  const aliasTargets = state.dictionary?.aliases?.[query] || [];
  const base = aliasTargets.map((key) => state.dictionaryMap.get(key)).find(Boolean);
  if (direct) return { entry: direct, base: base && base.w !== direct.w ? base : null, query };
  if (base) return { entry: base, base: null, query };
  if (query.endsWith("'s")) return dictionaryRecord(query.slice(0, -2));
  if (query.endsWith('s’')) return dictionaryRecord(query.slice(0, -2));
  if (query === "can't") return dictionaryRecord('can');
  if (query === "won't") return dictionaryRecord('will');
  if (query === "shan't") return dictionaryRecord('shall');
  if (query.endsWith("n't")) return dictionaryRecord(query.slice(0, -3));
  for (const suffix of ["'re", "'ve", "'ll", "'d", "'m"]) if (query.endsWith(suffix)) return dictionaryRecord(query.slice(0, -suffix.length));
  return null;
}

function coreRecord(raw) { return state.coreMap.get(wordKey(raw)) || null; }
function meaningFor(raw) {
  const core = coreRecord(raw);
  if (core) return core.meaningCN;
  const record = dictionaryRecord(raw);
  return flattenMeaning(record?.entry, 2) || '词典暂未收录';
}

function tokenizeInto(container, text, options = {}) {
  container.replaceChildren();
  const regex = /[A-Za-z]+(?:[-'’‘][A-Za-z]+)*/g;
  let last = 0;
  for (const match of text.matchAll(regex)) {
    container.append(document.createTextNode(text.slice(last, match.index)));
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lookup-token';
    button.textContent = match[0];
    const lookupWord = match[0].replace(/[’‘]/g, "'");
    button.title = `${meaningFor(lookupWord)}（点按查看与发音）`;
    button.addEventListener('click', () => openQuickLookup(lookupWord, options.context || null, button));
    container.append(button);
    last = match.index + match[0].length;
  }
  container.append(document.createTextNode(text.slice(last)));
  if (options.prefix) container.prepend(document.createTextNode(options.prefix));
}

function hydrateContextTokens(container) {
  $$('.phrase-token-line', container).forEach((line) => tokenizeInto(line, line.dataset.text || '', {
    context: { kind: 'phrase', text: line.dataset.text || '', meaning: line.dataset.meaning || '' },
  }));
  $$('.exam-token-line', container).forEach((line) => tokenizeInto(line, line.dataset.text || '', {
    context: { kind: 'exam', text: line.dataset.text || '', source: line.dataset.source || '' },
  }));
}

async function loadData() {
  els.loadingText.textContent = '载入四级单元与例句…';
  const study = await fetch(assetUrl('data/study-v5.json')).then((response) => {
    if (!response.ok) throw new Error(`刷词数据 HTTP ${response.status}`);
    return response.json();
  });
  state.studyData = study;
  els.dictEyebrow.textContent = '完整词典将在需要时载入';
  for (const chapter of [...study.chapters, study.extraChapter]) {
    for (const word of chapter.words) {
      if (!state.coreMap.has(word.key)) state.coreMap.set(word.key, word);
      if (!state.coreByLegacyId.has(String(word.id))) state.coreByLegacyId.set(String(word.id), word);
    }
  }
  state.wordStates = new Map((await getAllRecords('wordStates')).map((record) => [record.key, record]));
  const settings = await getRecord('settings', 'preferences');
  state.accent = settings?.accent === 'us' ? 'us' : 'uk';
  $$('.accent-btn').forEach((button) => button.classList.toggle('active', button.dataset.accent === state.accent));
  const migrated = await migrateSameOriginV4((id, chapterId) => {
    const chapter = [...study.chapters, study.extraChapter].find((item) => Number(item.id) === Number(chapterId));
    return chapter?.words.find((word) => String(word.id) === String(id)) || state.coreByLegacyId.get(String(id));
  });
  if (migrated) {
    state.wordStates = new Map((await getAllRecords('wordStates')).map((record) => [record.key, record]));
    toast(`已迁移 ${migrated} 条旧版错题/生词记录`);
  }
}

function buildChapterOptions() {
  const options = [
    { id: 0, label: `🎲 全部单词（${state.studyData.totalWords}）` },
    ...state.studyData.chapters.map((chapter) => ({ id: chapter.id, label: chapter.displayTitle })),
    { id: state.studyData.extraChapter.id, label: state.studyData.extraChapter.displayTitle },
  ];
  els.chapter.innerHTML = options.map((option) => `<option value="${option.id}">${escapeHtml(option.label)}</option>`).join('');
}

function syncModeButtons() {
  const enabled = { cn: state.showChinese, audio: state.autoAudio, random: state.randomOrder };
  $$('.mode-btn').forEach((button) => {
    const active = Boolean(enabled[button.dataset.mode]);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function restoreSequence(words, keys) {
  if (!Array.isArray(keys) || !keys.length) return null;
  const byKey = new Map(words.map((word) => [word.key, word]));
  const restored = [];
  const seen = new Set();
  for (const key of keys) {
    const word = byKey.get(key);
    if (word && !seen.has(key)) { restored.push(word); seen.add(key); }
  }
  for (const word of words) if (!seen.has(word.key)) restored.push(word);
  return restored.length === words.length ? restored : null;
}

async function loadProgress() {
  const saved = await getRecord('progress', `chapter:${state.chapterId}`);
  state.index = Number(saved?.index || 0);
  state.correct = Number(saved?.correct || 0);
  state.wrong = Number(saved?.wrong || 0);
  if (typeof saved?.showChinese === 'boolean') {
    state.showChinese = saved.showChinese;
    state.autoAudio = saved.autoAudio !== false;
    state.randomOrder = Boolean(saved.randomOrder);
  } else {
    const legacyMode = saved?.mode || 'cn';
    state.showChinese = legacyMode !== 'audio';
    state.autoAudio = true;
    state.randomOrder = legacyMode === 'random' || (!saved && state.chapterId === 0);
  }
  state.sequenceKeys = Array.isArray(saved?.sequenceKeys) ? saved.sequenceKeys : [];
  syncModeButtons();
  return saved;
}

async function saveProgress() {
  if (state.reviewMode) return;
  await putRecord('progress', {
    scope: `chapter:${state.chapterId}`,
    index: state.index,
    correct: state.correct,
    wrong: state.wrong,
    mode: state.randomOrder ? 'random' : (state.showChinese ? 'cn' : 'audio'),
    showChinese: state.showChinese,
    autoAudio: state.autoAudio,
    randomOrder: state.randomOrder,
    sequenceKeys: state.randomOrder ? state.sequence.map((word) => word.key) : [],
    updatedAt: new Date().toISOString(),
  });
}

async function selectChapter(id, reset = false) {
  state.reviewMode = false;
  state.chapterId = Number(id);
  els.chapter.value = String(state.chapterId);
  await loadProgress();
  const words = currentChapter().words;
  const restored = !reset && state.randomOrder ? restoreSequence(words, state.sequenceKeys) : null;
  state.sequence = restored || (state.randomOrder ? shuffle(words) : [...words]);
  if (reset || state.index >= state.sequence.length) state.index = 0;
  state.answered = false;
  state.correctionRequired = false;
  renderStudyWord();
  updateCounts();
}

function updateStudyPrompt(word = currentWord()) {
  if (!word) return;
  if (state.showChinese) els.prompt.textContent = word.meaningCN;
  else if (state.autoAudio) els.prompt.textContent = '听发音，拼出单词';
  else els.prompt.textContent = '无提示模式：根据字母长度回忆单词';
}

function renderSlots(word, input = '') {
  els.slots.replaceChildren();
  [...word].forEach((char, index) => {
    const slot = document.createElement('span');
    slot.className = `letter-slot${char === ' ' ? ' space' : ''}${input[index] ? ' filled' : ''}`;
    slot.textContent = char === ' ' ? '' : (input[index] || '');
    els.slots.append(slot);
  });
}

function renderStudyWord() {
  const word = currentWord();
  if (!word) {
    els.prompt.textContent = state.reviewMode ? '本轮复习完成' : '本单元完成';
    els.slots.replaceChildren();
    els.input.hidden = true;
    els.result.textContent = state.reviewMode ? '已完成当前复习列表。' : '可以重新开始或切换单元。';
    els.answer.hidden = true;
    updateCounts();
    return;
  }
  state.answered = false;
  state.correctionRequired = false;
  els.input.hidden = false;
  els.input.disabled = false;
  els.input.value = '';
  els.result.textContent = '';
  els.result.className = 'result-text';
  els.answer.hidden = true;
  els.answer.replaceChildren();
  els.submit.textContent = '提交 / 下一词';
  updateStudyPrompt(word);
  renderSlots(word.word);
  updateStarButton();
  updateStats();
  setTimeout(() => els.input.focus({ preventScroll: true }), 30);
  if (state.autoAudio) playWord(word, true);
}

function updateStats() {
  els.progress.textContent = `${Math.min(state.index, state.sequence.length)}/${state.sequence.length}`;
  els.correct.textContent = state.correct;
  els.wrong.textContent = state.wrong;
}

function updateStarButton() {
  const record = state.wordStates.get(wordKey(currentWord()?.word));
  const marked = Boolean(record?.starred);
  els.star.classList.toggle('active', marked);
  els.star.firstChild.textContent = marked ? '★ 已是生词 ' : '☆ 标记生词 ';
}

async function playUrl(url) {
  if (!url) return false;
  try {
    state.audio?.pause();
    if (state.audioObjectUrl) URL.revokeObjectURL(state.audioObjectUrl);
    state.audioObjectUrl = '';
    state.audio = new Audio(assetUrl(url));
    state.audio.preload = 'auto';
    await state.audio.play();
    return true;
  } catch (error) {
    console.warn('Audio failed', error);
    return false;
  }
}

async function playBlob(blob) {
  try {
    state.audio?.pause();
    if (state.audioObjectUrl) URL.revokeObjectURL(state.audioObjectUrl);
    state.audioObjectUrl = URL.createObjectURL(blob);
    state.audio = new Audio(state.audioObjectUrl);
    state.audio.preload = 'auto';
    await state.audio.play();
    return true;
  } catch (error) {
    console.warn('Packed audio failed', error);
    return false;
  }
}

function audioLookupKeys(raw) {
  const surface = wordKey(typeof raw === 'string' ? raw : raw?.word || raw?.w || '');
  const record = dictionaryRecord(surface);
  return [...new Set([surface, record?.query, record?.entry?.w, record?.base?.w].filter(Boolean))];
}

async function packedAudioBlob(raw, accent) {
  for (const key of audioLookupKeys(raw)) {
    const location = state.audioIndex.entries?.[key]?.[accent];
    if (!location) continue;
    const cacheKey = `${accent}:${key}`;
    if (state.audioClipCache.has(cacheKey)) return state.audioClipCache.get(cacheKey);
    const [shardId, offset, length] = location;
    const shard = state.audioIndex.shards?.[shardId];
    if (!shard) continue;
    const url = assetUrl(shard.url);
    const packCache = cacheStorageAvailable() ? await caches.open('shuaci-audio-v7-packs') : null;
    const cached = packCache ? await packCache.match(url) : null;
    let blob;
    if (cached) {
      const pack = await cached.blob();
      blob = pack.slice(offset, offset + length, 'audio/mpeg');
    } else {
      const response = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
      if (!response.ok) throw new Error(`Audio pack HTTP ${response.status}`);
      const payload = await response.blob();
      if (response.status === 206) blob = payload;
      else {
        if (packCache && payload.size === Number(shard.bytes)) await packCache.put(url, new Response(payload, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(payload.size) } }));
        blob = payload.slice(offset, offset + length, 'audio/mpeg');
      }
    }
    if (blob.size !== length) throw new Error(`Audio clip length mismatch for ${key}`);
    state.audioClipCache.set(cacheKey, blob);
    if (state.audioClipCache.size > 80) state.audioClipCache.delete(state.audioClipCache.keys().next().value);
    return blob;
  }
  return null;
}

async function playWord(wordOrText, automatic = false, requestedAccent = state.accent) {
  const accent = requestedAccent === 'us' ? 'us' : 'uk';
  const word = typeof wordOrText === 'string' ? coreRecord(wordOrText) : wordOrText;
  // 核心词的英音是小文件，先播放，不让手机等待 6 万词发音索引。
  if (accent === 'uk' && word?.audio) {
    const ok = await playUrl(word.audio);
    if (ok) return true;
  }
  try {
    await ensureAudioMetadataLoaded();
    const blob = await packedAudioBlob(wordOrText, accent);
    if (blob) return await playBlob(blob);
  } catch (error) {
    console.warn('Packed pronunciation unavailable', error);
  }
  if (accent === 'uk' && word?.audio) {
    const ok = await playUrl(word.audio);
    if (!ok && !automatic) toast('发音加载失败，请检查音频包或网络');
    return ok;
  }
  if (!automatic) toast('该词音频尚未下载完成，请到设置中继续下载双音包');
  return false;
}

async function playExample(word, accent = state.accent) {
  if (accent === 'us' && !state.exampleAudioUS[word.key]) await ensureAudioMetadataLoaded();
  const url = accent === 'us' ? state.exampleAudioUS[word.key] : word.exampleAudio;
  if (url && await playUrl(url)) return true;
  toast(`这条例句的${accent === 'us' ? '美音' : '英音'}暂不可用`);
  return false;
}

function examTagHtml(entry, fallback = '') {
  const tags = [...new Set(entry?.t || [])].filter((tag) => tag === 'cet4' || tag === 'cet6');
  if (!tags.length && fallback) return `<span class="tag hot">${escapeHtml(fallback)}</span>`;
  return tags.map((tag) => `<span class="tag ${tag}">${tag === 'cet4' ? '四级' : '六级'}</span>`).join('');
}

function normalizedSense(value) {
  return String(value || '').replace(/[\s，,；;。.!！?？、（）()\[\]]+/g, '').toLowerCase();
}

function levelSections(entry) {
  const levels = entry?.levels || {};
  if (!levels.cet4 && !levels.cet6) return '';
  const cet4Meanings = new Set((levels.cet4?.senses || []).flatMap((sense) => sense.meanings || []).map(normalizedSense));
  const renderLevel = (key, label) => {
    const level = levels[key];
    if (!level) return '';
    const senses = (level.senses || []).map((sense) => {
      const meanings = (sense.meanings || []).map((meaning) => {
        const isNew = key === 'cet6' && !cet4Meanings.has(normalizedSense(meaning));
        return `<span class="level-meaning${isNew ? ' level-new' : ''}">${escapeHtml(meaning)}${isNew ? '<small>六级新增/侧重</small>' : ''}</span>`;
      }).join('');
      return `<div class="level-sense"><b>${escapeHtml(sense.pos || '释义')}</b><div>${meanings}</div></div>`;
    }).join('');
    const phrases = (level.phrases || []).slice(0, 6).map(([phrase, meaning]) => `<li><div class="phrase-token-line" data-text="${escapeHtml(phrase)}" data-meaning="${escapeHtml(meaning)}"></div><span>${escapeHtml(meaning)}</span></li>`).join('');
    const exams = (level.examExamples || []).slice(0, 3).map(([text, source]) => `<blockquote><p class="exam-token-line" data-text="${escapeHtml(text)}" data-source="${escapeHtml(source)}"></p><cite>${escapeHtml(source)}</cite></blockquote>`).join('');
    return `<section class="exam-level-card ${key}"><header><span class="tag ${key}">${label}</span><strong>${label}重点义项与考点</strong></header>${senses || '<p class="muted">暂无独立分级释义，沿用通用释义。</p>'}${phrases ? `<h4>常用搭配</h4><ul class="level-phrases">${phrases}</ul>` : ''}${exams ? `<h4>真题语境</h4><div class="exam-contexts">${exams}</div>` : ''}</section>`;
  };
  return `<div class="exam-levels"><h3>四六级分级学习</h3>${renderLevel('cet4', '四级')}${renderLevel('cet6', '六级')}</div>`;
}

function relationHtml(entry) {
  const memory = entry?.wordFormation?.memory || [];
  const richFamily = entry?.relations?.family || [];
  const formation = memory.length ? `<div class="formation-card"><b>词根 / 构词助记</b>${memory.map((item) => `<p>${escapeHtml(item)}</p>`).join('')}</div>` : '';
  const familyLabel = memory.length ? '同根/派生词' : '派生/相关词';
  const family = richFamily.length ? `<div class="relation-group relation-family"><span>${familyLabel}</span>${richFamily.slice(0, 14).map((item) => `<button class="relation-chip" data-lookup-word="${escapeHtml(item.word)}" data-context-meaning="${escapeHtml(item.meaning || '')}">${escapeHtml(item.word)} <small>${escapeHtml([item.pos, item.meaning].filter(Boolean).join(' · ').slice(0, 42))}</small></button>`).join('')}</div>` : '';
  const groups = [
    ['f', '派生/相关词'], ['m', '形近词'], ['y', '同义替换'],
  ];
  const fallback = groups.map(([key, label]) => {
    if (key === 'f' && richFamily.length) return '';
    const words = entry?.r?.[key] || [];
    if (!words.length) return '';
    return `<div class="relation-group"><span>${label}</span>${words.slice(0, 12).map((word) => `<button class="relation-chip" data-lookup-word="${escapeHtml(word)}" data-context-meaning="${escapeHtml(meaningFor(word).slice(0, 80))}">${escapeHtml(word)} <small>${escapeHtml(meaningFor(word).slice(0, 24))}</small></button>`).join('')}</div>`;
  }).join('');
  const parts = `${formation}${family}${fallback}`;
  return parts ? `<div class="relation-block"><h3>关联词汇（点按可继续查词）</h3>${parts}</div>` : '';
}

function wireRelationButtons(container) {
  $$('[data-lookup-word]', container).forEach((button) => button.addEventListener('click', () => openQuickLookup(button.dataset.lookupWord, {
    kind: 'relation', meaning: button.dataset.contextMeaning || '',
  }, button)));
}

function renderAnswer(word) {
  const dictionary = dictionaryRecord(word.word)?.entry;
  els.answer.innerHTML = `
    <div class="answer-wordline"><strong>${escapeHtml(word.word)}</strong><span>${escapeHtml(word.phonetic || dictionary?.i || '')}</span><span class="tag">${escapeHtml(word.pos || '')}</span>${examTagHtml(dictionary, word.tag || '四级')}</div>
    <p><b>中文：</b>${escapeHtml(word.meaningCN)}</p>
    ${word.exampleEN ? '<p class="clickable-text example-line"><span class="answer-label">例句　</span></p>' : ''}
    ${word.exampleCN ? `<p>${escapeHtml(word.exampleCN)}</p>` : ''}
    ${word.extra ? '<p class="clickable-text extra-line"><span class="answer-label">补充　</span></p>' : ''}
    ${relationHtml(dictionary)}
    <p class="keyboard-tip">看完后按空格进入下一词；手机点“提交 / 下一词”。</p>`;
  if (word.exampleEN) {
    const line = $('.example-line', els.answer);
    tokenizeInto(line, word.exampleEN, { context: { kind: 'example', text: word.exampleEN, meaning: word.exampleCN } });
    for (const [accent, label] of [['uk', '英'], ['us', '美']]) {
      const play = document.createElement('button');
      play.type = 'button'; play.className = 'relation-chip'; play.textContent = `🔊 整句${label}音`;
      play.addEventListener('click', () => playExample(word, accent));
      line.append(' ', play);
    }
  }
  if (word.extra) tokenizeInto($('.extra-line', els.answer), word.extra, { context: { kind: 'supplement', text: word.extra } });
  wireRelationButtons(els.answer);
  els.answer.hidden = false;
}

async function saveWordState(word, patch) {
  const record = await patchWordState(word.word, patch);
  state.wordStates.set(record.key, record);
  updateCounts();
  updateStarButton();
  return record;
}

async function applyReviewResult(word, correct) {
  const existing = state.wordStates.get(word.key) || { reviewStreak: 0 };
  if (!correct) {
    await saveWordState(word, { reviewStreak: 0, wrong: true });
    return;
  }
  const streak = Number(existing.reviewStreak || 0) + 1;
  const patch = { reviewStreak: streak, correct: Number(existing.correct || 0) + 1 };
  if (streak >= 3) {
    patch[state.reviewBook] = false;
    patch.reviewStreak = 0;
    toast(`${word.word} 已连续答对 3 遍，自动移出${state.reviewBook === 'wrong' ? '错误本' : '生词本'}`);
  }
  await saveWordState(word, patch);
}

async function submitAnswer() {
  const word = currentWord();
  if (!word) return;
  if (state.answered && !state.correctionRequired) { await nextWord(); return; }
  const answer = wordKey(els.input.value);
  if (!answer) { toast('请先输入单词'); return; }
  const expected = wordKey(word.word);
  if (state.correctionRequired) {
    if (answer !== expected) {
      els.result.textContent = `仍不正确，请完整输入：${word.word}`;
      els.result.className = 'result-text bad';
      return;
    }
    state.correctionRequired = false;
    state.answered = true;
    els.result.textContent = '订正完成，现在可以按空格进入下一词';
    els.result.className = 'result-text good';
    els.submit.textContent = '下一词';
    els.input.blur();
    return;
  }
  renderAnswer(word);
  if (answer === expected) {
    state.correct += 1;
    state.answered = true;
    els.result.textContent = '正确！看完释义后按空格进入下一词';
    els.result.className = 'result-text good';
    els.submit.textContent = '下一词';
    els.input.blur();
    if (state.reviewMode) await applyReviewResult(word, true);
    else {
      const old = state.wordStates.get(word.key) || {};
      await saveWordState(word, { correct: Number(old.correct || 0) + 1 });
    }
  } else {
    state.wrong += 1;
    state.correctionRequired = true;
    els.result.textContent = `错误！正确单词：${word.word}。请再完整输入一遍，答对后才能继续。`;
    els.result.className = 'result-text bad';
    els.input.value = '';
    els.input.focus();
    const old = state.wordStates.get(word.key) || {};
    await saveWordState(word, { wrong: true, reviewStreak: 0, errors: Number(old.errors || 0) + 1 });
    if (state.reviewMode) await applyReviewResult(word, false);
  }
  renderSlots(word.word, els.input.value);
  await saveProgress();
}

async function nextWord(direction = 1) {
  if (state.correctionRequired) { toast('请先完成正确拼写订正'); return; }
  if (!state.answered && currentWord()) { toast('请先提交当前单词'); return; }
  state.index += direction;
  if (state.index < 0) state.index = 0;
  await saveProgress();
  renderStudyWord();
}

async function toggleStar(rawWord = currentWord()?.word) {
  if (!rawWord) return;
  const key = wordKey(rawWord);
  const current = state.wordStates.get(key) || {};
  await saveWordState({ word: rawWord }, { starred: !current.starred, reviewStreak: 0 });
  toast(!current.starred ? '已加入生词本' : '已移出生词本');
  if ($('[data-view="books"]:not([hidden])')) renderBookList();
}

function updateCounts() {
  let wrong = 0; let starred = 0;
  for (const record of state.wordStates.values()) {
    if (record.wrong) wrong += 1;
    if (record.starred) starred += 1;
  }
  els.wrongCount.textContent = wrong;
  els.starCount.textContent = starred;
  els.wrongTabCount.textContent = wrong;
  els.starTabCount.textContent = starred;
}

async function switchView(name) {
  $$('.view').forEach((view) => { view.hidden = view.dataset.view !== name; });
  $$('.nav-btn').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
  if (name === 'overview') renderOverview();
  if (name === 'dictionary') {
    els.dictList.innerHTML = '<div class="empty-state">正在载入完整词典，首次请稍候…</div>';
    els.dictSummary.textContent = '刷词功能已可用；词典正在单独载入';
    try {
      await ensureDictionaryLoaded();
      renderDictionary(true);
    } catch (error) {
      els.dictList.innerHTML = '<div class="empty-state">词典载入失败，请检查网络后再点一次“词典”。</div>';
    }
  }
  if (name === 'books') renderBookList();
  scrollTo({ top: 0, behavior: 'smooth' });
}

function orderedOverviewWords() {
  let words = [...currentChapter().words];
  if (state.overviewOrder === 'alpha') words.sort((a, b) => a.word.localeCompare(b.word));
  if (state.overviewOrder === 'shuffle') words = shuffle(words);
  const query = wordKey(els.overviewSearch.value);
  if (query) words = words.filter((word) => word.key.includes(query) || word.meaningCN.includes(query));
  return words;
}

function renderOverview() {
  const chapter = currentChapter();
  els.overviewTitle.textContent = chapter.displayTitle || chapter.title;
  const words = orderedOverviewWords();
  els.overviewList.innerHTML = words.map((word, index) => `
    <article class="word-card" data-overview-index="${index}">
      <h2>${escapeHtml(word.word)}</h2><div class="phonetic">${escapeHtml(word.phonetic)}</div>
      <div class="tags"><span class="tag">${escapeHtml(word.pos)}</span>${examTagHtml(dictionaryRecord(word.word)?.entry, word.tag)}</div>
      <p class="meaning">${escapeHtml(word.meaningCN)}</p>
      <button class="mini-audio" data-audio-index="${index}" aria-label="播放 ${escapeHtml(word.word)}">🔊</button>
    </article>`).join('');
  $$('.word-card', els.overviewList).forEach((card) => card.addEventListener('click', (event) => {
    if (event.target.closest('[data-audio-index]')) return;
    openCoreDetail(words[Number(card.dataset.overviewIndex)], words, Number(card.dataset.overviewIndex));
  }));
  $$('[data-audio-index]', els.overviewList).forEach((button) => button.addEventListener('click', () => playWord(words[Number(button.dataset.audioIndex)])));
}

function filteredDictionary() {
  if (!state.dictionary?.entries) return [];
  const query = wordKey(els.dictSearch.value);
  const chinese = /[\u3400-\u9fff]/.test(query);
  const result = [];
  for (const entry of state.dictionary.entries) {
    if (state.dictionaryFilter !== 'all' && !(entry.t || []).includes(state.dictionaryFilter)) continue;
    if (state.dictionaryLetter !== 'all' && entry.w.charAt(0).toUpperCase() !== state.dictionaryLetter) continue;
    if (query) {
      if (chinese) {
        if (!flattenMeaning(entry, 20).includes(query)) continue;
      } else if (!entry.w.includes(query)) continue;
    }
    result.push(entry);
  }
  return result;
}

function syncDictionaryAlphabet() {
  $$('[data-dict-letter]', els.dictAlphabet).forEach((button) => button.classList.toggle('active', button.dataset.dictLetter === state.dictionaryLetter));
}

function selectDictionaryLetter(letter) {
  if (state.dictionaryLetter === letter && !els.dictSearch.value) return;
  state.dictionaryLetter = letter;
  els.dictSearch.value = '';
  syncDictionaryAlphabet();
  renderDictionary(true);
  scrollTo({ top: Math.max(0, els.dictAlphabet.getBoundingClientRect().top + scrollY - 78), behavior: 'smooth' });
}

function buildDictionaryAlphabet() {
  const letters = ['all', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
  els.dictAlphabet.innerHTML = letters.map((letter) => `<button type="button" data-dict-letter="${letter}" aria-label="${letter === 'all' ? '全部字母' : `${letter} 开头`}">${letter === 'all' ? '<span class="desktop-all">全部</span><span class="mobile-all">全</span>' : letter}</button>`).join('');
  const chooseAt = (clientX, clientY) => {
    const button = document.elementFromPoint(clientX, clientY)?.closest('[data-dict-letter]');
    if (button && button.closest('#dictionaryAlphabet')) selectDictionaryLetter(button.dataset.dictLetter);
  };
  let dragging = false;
  els.dictAlphabet.addEventListener('click', (event) => {
    const button = event.target.closest('[data-dict-letter]');
    if (button) selectDictionaryLetter(button.dataset.dictLetter);
  });
  els.dictAlphabet.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') return;
    dragging = true;
    els.dictAlphabet.setPointerCapture?.(event.pointerId);
    chooseAt(event.clientX, event.clientY);
    event.preventDefault();
  });
  els.dictAlphabet.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    chooseAt(event.clientX, event.clientY);
    event.preventDefault();
  });
  els.dictAlphabet.addEventListener('pointerup', () => { dragging = false; });
  els.dictAlphabet.addEventListener('pointercancel', () => { dragging = false; });
  syncDictionaryAlphabet();
}

function dictionaryRowHtml(entry, index) {
  return `
    <article class="dictionary-row">
      <button class="word-open" data-dict-index="${index}">${escapeHtml(entry.w)}</button>
      <div class="row-meaning">${escapeHtml(flattenMeaning(entry, 4))}</div>
      <div class="row-meta">${examTagHtml(entry)}</div>
    </article>`;
}

function renderDictionary(reset = false) {
  if (reset) {
    state.dictionaryMatches = filteredDictionary();
    state.dictionaryRendered = 0;
    els.dictList.replaceChildren();
  }
  const start = state.dictionaryRendered;
  const end = Math.min(start + state.dictionaryBatch, state.dictionaryMatches.length);
  if (end > start) els.dictList.insertAdjacentHTML('beforeend', state.dictionaryMatches.slice(start, end).map((entry, offset) => dictionaryRowHtml(entry, start + offset)).join(''));
  state.dictionaryRendered = end;
  if (!state.dictionaryMatches.length) els.dictList.innerHTML = '<div class="empty-state">没有找到符合条件的词条，请更换字母、考试级别或搜索内容。</div>';
  const letterText = state.dictionaryLetter === 'all' ? '全部字母' : `${state.dictionaryLetter} 开头`;
  els.dictSummary.textContent = `${letterText} · 找到 ${state.dictionaryMatches.length.toLocaleString()} 条，已显示 ${state.dictionaryRendered.toLocaleString()} 条`;
  $$('[data-dict-index]', els.dictList).slice(start).forEach((button) => button.addEventListener('click', () => {
    const index = Number(button.dataset.dictIndex);
    openDictionaryDetail(state.dictionaryMatches[index].w, state.dictionaryMatches, index);
  }));
  els.dictSentinel.hidden = state.dictionaryRendered >= state.dictionaryMatches.length;
}

function setupDictionaryAutoLoad() {
  if ('IntersectionObserver' in window) {
    state.dictionaryObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !els.dictSentinel.hidden && !$('#dictionaryView').hidden) renderDictionary(false);
    }, { rootMargin: '700px 0px' });
    state.dictionaryObserver.observe(els.dictSentinel);
  }
  addEventListener('scroll', () => {
    if (els.dictSentinel.hidden || $('#dictionaryView').hidden) return;
    if (els.dictSentinel.getBoundingClientRect().top < innerHeight + 700) renderDictionary(false);
  }, { passive: true });
}

function bookWords(type = state.activeBook) {
  const keys = [...state.wordStates.values()].filter((record) => Boolean(record[type])).map((record) => record.key);
  return keys.map((key) => coreRecord(key) || dictionaryRecord(key)?.entry).filter(Boolean);
}

function renderBookList() {
  const words = bookWords();
  els.bookList.innerHTML = words.length ? words.map((word, index) => {
    const raw = word.word || word.w;
    const record = state.wordStates.get(wordKey(raw)) || {};
    return `<article class="book-row"><button class="word-open" data-book-index="${index}">${escapeHtml(raw)}</button><div class="row-meaning">${escapeHtml(word.meaningCN || flattenMeaning(word, 4))}</div><div class="row-meta"><span class="tag">连对 ${record.reviewStreak || 0}/3</span><button class="relation-chip" data-remove-book="${index}">移出</button></div></article>`;
  }).join('') : '<div class="empty-state">这里还没有单词。刷词时答错或标记后会自动出现。</div>';
  $$('[data-book-index]', els.bookList).forEach((button) => button.addEventListener('click', () => {
    const index = Number(button.dataset.bookIndex); const word = words[index];
    if (word.word) openCoreDetail(word, words, index); else openDictionaryDetail(word.w, words.map((item) => item.word || item.w), index);
  }));
  $$('[data-remove-book]', els.bookList).forEach((button) => button.addEventListener('click', async () => {
    const word = words[Number(button.dataset.removeBook)];
    await saveWordState({ word: word.word || word.w }, { [state.activeBook]: false, reviewStreak: 0 });
    renderBookList();
  }));
}

async function startBookReview() {
  const words = bookWords();
  if (!words.length) { toast('当前复习本没有单词'); return; }
  state.reviewMode = true;
  state.reviewBook = state.activeBook;
  state.sequence = shuffle(words.map((word) => word.word ? word : ({
    word: word.w, key: word.w, phonetic: word.i ? `/${word.i}/` : '', pos: word.s?.[0]?.p || '', meaningCN: flattenMeaning(word),
    tag: (word.t || [])[0]?.toUpperCase() || '词典', exampleEN: '', exampleCN: '', extra: '', audio: '', exampleAudio: '',
  })));
  state.index = 0; state.correct = 0; state.wrong = 0;
  switchView('study');
  renderStudyWord();
  toast(`开始复习${state.reviewBook === 'wrong' ? '错误本' : '生词本'}；连续答对三遍会自动移出`);
}

function relationSection(entry) {
  const content = relationHtml(entry);
  return content ? `<div class="detail-relations">${content}</div>` : '';
}

function quickLookupHtml(query, context) {
  const record = dictionaryRecord(query);
  const core = coreRecord(query) || coreRecord(record?.entry?.w);
  const entry = record?.entry;
  const lemma = entry?.w || core?.word || '';
  const phonetic = core?.phonetic || (entry?.i ? `/${entry.i}/` : '');
  const pos = core?.pos || entry?.s?.[0]?.p || '';
  const meanings = [];
  const addMeaning = (value) => {
    const clean = String(value || '').trim();
    if (clean && !meanings.some((item) => normalizedSense(item) === normalizedSense(clean))) meanings.push(clean);
  };
  addMeaning(core?.meaningCN);
  for (const level of [entry?.levels?.cet4, entry?.levels?.cet6]) {
    for (const sense of level?.senses || []) for (const meaning of sense.meanings || []) addMeaning(`${sense.pos || ''} ${meaning}`.trim());
  }
  for (const sense of entry?.s || []) {
    const joined = (sense.z || []).slice(0, 4).join('；');
    if (joined) addMeaning(`${sense.p || ''} ${joined}`.trim());
  }
  const labels = { phrase: '当前搭配', example: '所在例句', exam: '真题语境', supplement: '补充内容', relation: '关联说明' };
  const contextHtml = context && (context.text || context.meaning || context.source) ? `<div class="lookup-context"><b>${escapeHtml(labels[context.kind] || '当前语境')}：</b>${context.text ? `<div>${escapeHtml(context.text)}</div>` : ''}${context.meaning ? `<div>${escapeHtml(context.meaning)}</div>` : ''}${context.source ? `<small>${escapeHtml(context.source)}</small>` : ''}</div>` : '';
  const meaningHtml = meanings.length
    ? meanings.slice(0, 3).map((meaning) => `<div class="lookup-meaning">${escapeHtml(meaning)}</div>`).join('')
    : '<div class="lookup-meaning">专有名词或当前离线词典暂无通用释义；不会用猜测内容代替。</div>';
  return `
    <header class="lookup-heading"><h2>${escapeHtml(query)}</h2>${phonetic ? `<span class="phonetic">${escapeHtml(phonetic)}</span>` : ''}${lemma && wordKey(query) !== wordKey(lemma) ? `<p class="lookup-lemma">词形还原：${escapeHtml(lemma)}</p>` : ''}</header>
    <div class="detail-audio-row"><span class="tag">${escapeHtml(pos || '词汇')}</span>${examTagHtml(entry, core?.tag || '')}</div>
    ${contextHtml}
    <div class="lookup-meanings"><b>常用义</b>${meaningHtml}</div>
    <div class="lookup-actions"><button class="soft-btn quick-audio audio-accent-btn" data-accent="uk">🔊 英音</button><button class="soft-btn quick-audio audio-accent-btn" data-accent="us">🔊 美音</button><button class="primary-btn quick-full-detail">查看完整释义</button></div>`;
}

function hideQuickLookup() {
  els.lookupOverlay.classList.remove('open');
  els.lookupOverlay.setAttribute('aria-hidden', 'true');
  state.quickLookupActive = false;
  const focus = state.quickLookup?.returnFocus;
  state.quickLookup = null;
  if (focus?.isConnected) focus.focus({ preventScroll: true });
}

async function openQuickLookup(query, context = null, anchor = null) {
  if (!state.dictionary) {
    try { await ensureDictionaryLoaded(); } catch (error) { console.warn('Dictionary lookup unavailable', error); }
  }
  const alreadyOpen = state.quickLookupActive;
  state.quickLookup = { query, context, returnFocus: anchor };
  els.lookup.innerHTML = quickLookupHtml(query, context);
  els.lookupOverlay.classList.add('open');
  els.lookupOverlay.setAttribute('aria-hidden', 'false');
  state.quickLookupActive = true;
  if (innerWidth > 720 && anchor) {
    const rect = anchor.getBoundingClientRect();
    const cardWidth = els.lookupCard.offsetWidth || 390;
    const cardHeight = els.lookupCard.offsetHeight || 390;
    const left = Math.max(15, Math.min(innerWidth - cardWidth - 15, rect.left));
    const preferredTop = rect.bottom + 10;
    const top = Math.max(15, Math.min(innerHeight - cardHeight - 15, preferredTop));
    els.lookupCard.style.left = `${left}px`;
    els.lookupCard.style.top = `${top}px`;
  } else {
    els.lookupCard.style.left = '';
    els.lookupCard.style.top = '';
  }
  $$('.quick-audio', els.lookup).forEach((button) => button.addEventListener('click', async () => {
    $$('.quick-audio', els.lookup).forEach((item) => item.classList.toggle('playing', item === button));
    await playWord(query, false, button.dataset.accent);
    button.classList.remove('playing');
  }));
  $('.quick-full-detail', els.lookup).addEventListener('click', openQuickFullDetail);
  if (!alreadyOpen) history.pushState({ shuaciQuick: true, detailDepth: state.detailBrowserDepth }, '');
}

function closeQuickLookup(fromHistory = false) {
  if (!state.quickLookupActive) return;
  if (!fromHistory) {
    history.back();
    return;
  }
  hideQuickLookup();
}

async function openQuickFullDetail() {
  if (!state.quickLookup) return;
  const query = state.quickLookup.query;
  hideQuickLookup();
  if (state.detailSessionActive && els.overlay.classList.contains('open')) {
    state.detailTrail.push(currentDetailSnapshot());
    state.detailBrowserDepth += 1;
    history.replaceState({ shuaciDetail: true, depth: state.detailBrowserDepth }, '');
    await renderDictionaryDetail(query, [query], 0, 0);
    return;
  }
  state.detailTrail = [];
  state.detailBrowserDepth = 0;
  state.detailSessionActive = true;
  state.detailClosing = false;
  history.replaceState({ shuaciDetail: true, depth: 0 }, '');
  await renderDictionaryDetail(query, [query], 0, 0);
}

function detailBackHtml() {
  if (!state.detailTrail.length) return '';
  const previous = state.detailTrail[state.detailTrail.length - 1];
  const label = previous.kind === 'core' ? previous.item.word : previous.query;
  return `<button type="button" class="detail-back">← 返回 ${escapeHtml(label)}</button>`;
}

async function detailCoreHtml(word) {
  const dictionary = dictionaryRecord(word.word);
  const note = await getRecord('notes', word.key);
  const senses = dictionary?.entry?.s || [];
  return `
    ${detailBackHtml()}
    <header class="detail-heading"><h1>${escapeHtml(word.word)}</h1><span class="phonetic">${escapeHtml(word.phonetic || dictionary?.entry?.i || '')}</span></header>
    <div class="detail-audio-row"><button class="soft-btn detail-word-audio" data-accent="uk">🔊 英音</button><button class="soft-btn detail-word-audio" data-accent="us">🔊 美音</button><span class="tag">${escapeHtml(word.pos)}</span>${examTagHtml(dictionary?.entry, word.tag)}</div>
    <h2>${escapeHtml(word.meaningCN)}</h2>
    ${senses.length ? `<h3>完整常见释义</h3><div class="detail-senses">${senses.map((sense) => `<div class="sense-row"><b>${escapeHtml(sense.p || '释义')}</b>　${escapeHtml((sense.z || []).join('；'))}</div>`).join('')}</div>` : ''}
    ${levelSections(dictionary?.entry)}
    ${word.exampleEN ? `<div class="detail-example"><button class="soft-btn detail-example-audio" data-accent="uk">🔊 例句英音</button> <button class="soft-btn detail-example-audio" data-accent="us">🔊 例句美音</button><p class="clickable-text detail-example-en"></p><p>${escapeHtml(word.exampleCN)}</p></div>` : ''}
    ${word.extra ? '<div class="detail-extra clickable-text detail-extra-text"><b>补充：</b></div>' : ''}
    ${relationSection(dictionary?.entry)}
    <h3>📝 我的批注</h3><textarea class="detail-note" placeholder="在此输入自己的记忆、讲解或备注…">${escapeHtml(note?.text || '')}</textarea>`;
}

async function detailDictionaryHtml(query) {
  const record = dictionaryRecord(query);
  if (!record) return `${detailBackHtml()}<header class="detail-heading"><h1>${escapeHtml(query)}</h1></header><div class="empty-state">离线词典暂未收录这个词。</div>`;
  const { entry, base } = record;
  const note = await getRecord('notes', wordKey(query));
  return `
    ${detailBackHtml()}
    <header class="detail-heading"><h1>${escapeHtml(query)}</h1>${query !== entry.w ? `<span class="phonetic">→ ${escapeHtml(entry.w)}</span>` : `<span class="phonetic">/${escapeHtml(entry.i || '')}/</span>`}</header>
    <div class="detail-audio-row"><button class="soft-btn detail-dict-audio" data-accent="uk">🔊 英音</button><button class="soft-btn detail-dict-audio" data-accent="us">🔊 美音</button>${examTagHtml(entry)}${entry.q === 'fallback' ? '<span class="tag">回退词条</span>' : ''}</div>
    <h3>完整常见释义</h3><div class="detail-senses">${entry.s.map((sense) => `<div class="sense-row"><b>${escapeHtml(sense.p || '释义')}</b>　${escapeHtml((sense.z || []).join('；'))}</div>`).join('')}</div>
    ${levelSections(entry)}
    ${base ? `<div class="detail-extra"><b>词形还原：</b>${escapeHtml(query)} 也可还原为 <button class="token-link" data-lookup-word="${escapeHtml(base.w)}" data-context-meaning="${escapeHtml(flattenMeaning(base, 3))}">${escapeHtml(base.w)}</button>（${escapeHtml(flattenMeaning(base, 3))}）</div>` : ''}
    ${relationSection(entry)}
    <h3>📝 我的批注</h3><textarea class="detail-note" placeholder="在此输入自己的记忆、讲解或备注…">${escapeHtml(note?.text || '')}</textarea>`;
}

async function renderCoreDetail(word, sequence = [word], index = 0, scrollTop = 0) {
  state.detailSource = 'core'; state.detailSequence = sequence; state.detailIndex = index;
  els.detail.innerHTML = await detailCoreHtml(word);
  $$('.detail-word-audio', els.detail).forEach((button) => button.addEventListener('click', () => playWord(word, false, button.dataset.accent)));
  $$('.detail-example-audio', els.detail).forEach((button) => button.addEventListener('click', () => playExample(word, button.dataset.accent)));
  if (word.exampleEN) tokenizeInto($('.detail-example-en', els.detail), word.exampleEN, { context: { kind: 'example', text: word.exampleEN, meaning: word.exampleCN } });
  if (word.extra) tokenizeInto($('.detail-extra-text', els.detail), word.extra, { prefix: '补充：', context: { kind: 'supplement', text: word.extra } });
  hydrateContextTokens(els.detail);
  wireDetail(word.word);
  openOverlay(scrollTop);
}

async function renderDictionaryDetail(query, sequence = [query], index = 0, scrollTop = 0) {
  state.detailSource = 'dictionary'; state.detailSequence = sequence; state.detailIndex = index;
  els.detail.innerHTML = await detailDictionaryHtml(query);
  $$('.detail-dict-audio', els.detail).forEach((button) => button.addEventListener('click', () => playWord(query, false, button.dataset.accent)));
  hydrateContextTokens(els.detail);
  wireDetail(query);
  openOverlay(scrollTop);
}

function beginDetailSession() {
  if (state.detailSessionActive) return;
  state.detailTrail = [];
  state.detailBrowserDepth = 0;
  state.detailSessionActive = true;
  state.detailClosing = false;
  history.pushState({ shuaciDetail: true, depth: 0 }, '');
}

async function openCoreDetail(word, sequence = [word], index = 0) {
  beginDetailSession();
  if (!state.dictionary) {
    els.detail.innerHTML = '<div class="empty-state">正在载入该词的完整词典资料…</div>';
    state.detailSequence = sequence; state.detailIndex = index;
    openOverlay(0);
    try { await ensureDictionaryLoaded(); } catch (error) { console.warn('Dictionary detail unavailable', error); }
  }
  await renderCoreDetail(word, sequence, index, 0);
}

async function openDictionaryDetail(query, sequence = [query], index = 0) {
  beginDetailSession();
  if (!state.dictionary) {
    els.detail.innerHTML = '<div class="empty-state">正在载入完整词典资料…</div>';
    state.detailSequence = sequence; state.detailIndex = index;
    openOverlay(0);
    await ensureDictionaryLoaded();
  }
  await renderDictionaryDetail(query, sequence, index, 0);
}

function currentDetailSnapshot() {
  const item = state.detailSequence[state.detailIndex];
  if (state.detailSource === 'core') return { kind: 'core', item, sequence: state.detailSequence, index: state.detailIndex, scrollTop: els.detailScroll.scrollTop };
  return { kind: 'dictionary', query: typeof item === 'string' ? item : item?.word || item?.w || $('.detail-heading h1', els.detail)?.textContent || '', sequence: state.detailSequence, index: state.detailIndex, scrollTop: els.detailScroll.scrollTop };
}

async function renderDetailSnapshot(snapshot) {
  if (!snapshot) return;
  if (snapshot.kind === 'core') await renderCoreDetail(snapshot.item, snapshot.sequence, snapshot.index, snapshot.scrollTop);
  else await renderDictionaryDetail(snapshot.query, snapshot.sequence, snapshot.index, snapshot.scrollTop);
}

async function openLinkedDictionaryDetail(query) {
  if (!els.overlay.classList.contains('open') || !state.detailSessionActive) {
    await openDictionaryDetail(query);
    return;
  }
  state.detailTrail.push(currentDetailSnapshot());
  state.detailBrowserDepth += 1;
  history.pushState({ shuaciDetail: true, depth: state.detailBrowserDepth }, '');
  await renderDictionaryDetail(query, [query], 0, 0);
}

function backDetail() {
  if (state.detailBrowserDepth > 0) history.back();
  else closeOverlay();
}

function wireDetail(noteWord) {
  wireRelationButtons(els.detail);
  $('.detail-back', els.detail)?.addEventListener('click', backDetail);
  $('.detail-note', els.detail)?.addEventListener('input', (event) => {
    clearTimeout(wireDetail.noteTimer);
    wireDetail.noteTimer = setTimeout(() => setNote(noteWord, event.target.value), 350);
  });
  enableSelectionLookup(els.detail);
}

function openOverlay(scrollTop = 0) {
  els.overlay.classList.add('open');
  els.overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  const total = state.detailSequence.length;
  els.swipeCue.hidden = total < 2;
  els.swipeCue.textContent = total > 1 ? `‹  左右滑动切词  ${state.detailIndex + 1} / ${total}  ›` : '';
  const target = Math.max(0, Number(scrollTop) || 0);
  // Replacing a long detail document briefly resets an already-open scroller.
  // Restore again after layout so nested lookups return to the exact reading point.
  els.detailScroll.scrollTop = target;
  requestAnimationFrame(() => {
    els.detailScroll.scrollTop = target;
    requestAnimationFrame(() => { els.detailScroll.scrollTop = target; });
  });
}

function finishCloseOverlay() {
  els.overlay.classList.remove('open');
  els.overlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  state.detailTrail = [];
  state.detailBrowserDepth = -1;
  state.detailSessionActive = false;
}

function closeOverlay(fromHistory = false) {
  if (!fromHistory && state.detailSessionActive) {
    const steps = state.detailBrowserDepth + 1;
    state.detailClosing = true;
    finishCloseOverlay();
    if (steps > 0) history.go(-steps);
    return;
  }
  finishCloseOverlay();
}

async function swipeDetail(direction) {
  const next = state.detailIndex + direction;
  if (next < 0 || next >= state.detailSequence.length) { toast('已经到这一组的边缘'); return; }
  state.detailIndex = next;
  els.sheet.classList.remove('slide-left', 'slide-right');
  void els.sheet.offsetWidth;
  els.sheet.classList.add(direction > 0 ? 'slide-left' : 'slide-right');
  const item = state.detailSequence[next];
  if (state.detailSource === 'core') await renderCoreDetail(item, state.detailSequence, next, 0);
  else await renderDictionaryDetail(typeof item === 'string' ? item : item.word || item.w, state.detailSequence, next, 0);
}

function enableSelectionLookup(container) {
  container.onpointerup = (event) => {
    if (event.target.closest('button,textarea,input')) return;
    setTimeout(() => {
      const text = getSelection()?.toString().trim();
      if (text && /^[A-Za-z]+(?:[-'’‘][A-Za-z]+)*$/.test(text)) openQuickLookup(text.replace(/[’‘]/g, "'"), { kind: 'selection' }, container);
    }, 0);
  };
}

addEventListener('popstate', async (event) => {
  if (state.quickLookupActive) {
    closeQuickLookup(true);
    return;
  }
  if (!state.detailSessionActive) return;
  const targetDepth = event.state?.shuaciDetail ? Number(event.state.depth) : -1;
  if (targetDepth < 0) {
    closeOverlay(true);
    return;
  }
  if (targetDepth >= state.detailBrowserDepth) return;
  let snapshot = null;
  while (state.detailBrowserDepth > targetDepth) {
    snapshot = state.detailTrail.pop() || snapshot;
    state.detailBrowserDepth -= 1;
  }
  await renderDetailSnapshot(snapshot);
});

async function syncAudioPackStatus() {
  await ensureAudioMetadataLoaded();
  const shards = state.audioIndex.shards || [];
  if (!shards.length) return;
  if (!cacheStorageAvailable()) {
    els.offlineStatus.textContent = '当前是手机局域网在线模式：单词和例句可播放；完整离线下载需要 HTTPS 网站。';
    $('#downloadCoreAudio').textContent = '局域网模式暂不支持完整离线下载';
    $('#downloadCoreAudio').disabled = true;
    return;
  }
  const cache = await caches.open('shuaci-audio-v7-packs');
  let complete = 0; let bytes = 0;
  for (const shard of shards) {
    const response = await cache.match(assetUrl(shard.url));
    if (!response) continue;
    const size = Number(response.headers.get('content-length') || (await response.clone().blob()).size);
    if (size === Number(shard.bytes)) { complete += 1; bytes += size; }
  }
  if (!complete) return;
  els.audioProgress.hidden = false;
  els.audioProgress.value = Math.round(bytes / Number(state.audioIndex.totalBytes) * 92);
  els.offlineStatus.textContent = complete === shards.length
    ? '双音词典分片已全部下载；例句音频可点击按钮重新校验。'
    : `已保存 ${complete}/${shards.length} 个双音分片；点击可继续下载。`;
  $('#downloadCoreAudio').textContent = complete === shards.length ? '校验并补齐完整双音包' : '继续下载完整英美双音包';
}

async function downloadCoreAudio() {
  await ensureAudioMetadataLoaded();
  const button = $('#downloadCoreAudio');
  if (!cacheStorageAvailable()) {
    els.offlineStatus.textContent = '手机通过局域网可以在线使用；若要关闭电脑后仍能用，需要部署到 HTTPS 网站。';
    toast('局域网 HTTP 模式不能保存完整离线包');
    return;
  }
  if (state.audioPackDownload) {
    state.audioPackDownload.controller.abort();
    state.audioPackDownload = null;
    button.textContent = '继续下载完整英美双音包';
    els.offlineStatus.textContent = '下载已暂停；再次点击会从已完成的分片继续。';
    return;
  }
  const shards = state.audioIndex.shards || [];
  if (!shards.length) { toast('完整双音包索引尚未准备好'); return; }
  const estimate = await navigator.storage?.estimate?.();
  await navigator.storage?.persist?.().catch(() => false);
  const required = Number(state.audioIndex.totalBytes || 0) + 180 * 1024 * 1024;
  const available = Number(estimate?.quota || 0) - Number(estimate?.usage || 0);
  if (estimate?.quota && available < required * 1.05) {
    els.offlineStatus.textContent = `空间不足：还需约 ${(required / 1024 / 1024 / 1024).toFixed(2)} GB，当前浏览器可用约 ${(Math.max(0, available) / 1024 / 1024 / 1024).toFixed(2)} GB。`;
    toast('浏览器可用空间不足，未开始下载');
    return;
  }
  const controller = new AbortController();
  state.audioPackDownload = { controller };
  button.textContent = '暂停下载';
  els.audioProgress.hidden = false; els.audioProgress.value = 0;
  const packCache = await caches.open('shuaci-audio-v7-packs');
  const exampleCache = await caches.open('shuaci-v7-audio-runtime');
  let cachedBytes = 0; let failed = 0;
  const digestHex = async (buffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map((value) => value.toString(16).padStart(2, '0')).join('');
  try {
    for (let index = 0; index < shards.length; index += 1) {
      const shard = shards[index];
      const absolute = assetUrl(shard.url);
      const existing = await packCache.match(absolute);
      let existingValid = false;
      if (existing) {
        const existingBuffer = await existing.arrayBuffer();
        existingValid = existingBuffer.byteLength === Number(shard.bytes) && await digestHex(existingBuffer) === shard.sha256;
      }
      if (existingValid) cachedBytes += Number(shard.bytes);
      else {
        if (existing) await packCache.delete(absolute);
        const response = await fetch(absolute, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength !== Number(shard.bytes) || await digestHex(buffer) !== shard.sha256) throw new Error(`分片校验失败：${shard.url}`);
        await packCache.put(absolute, new Response(buffer, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(buffer.byteLength) } }));
        cachedBytes += buffer.byteLength;
      }
      els.audioProgress.value = Math.round(cachedBytes / Number(state.audioIndex.totalBytes) * 92);
      els.offlineStatus.textContent = `双音词典分片 ${index + 1}/${shards.length}，已完成 ${(cachedBytes / 1024 / 1024).toFixed(0)} MB；可随时暂停。`;
    }
    const urls = new Set();
    for (const chapter of state.studyData.chapters) {
      for (const word of chapter.words) {
        if (word.exampleAudio) urls.add(word.exampleAudio);
        if (state.exampleAudioUS[word.key]) urls.add(state.exampleAudioUS[word.key]);
      }
    }
    const list = [...urls];
    let cursor = 0; let complete = 0;
    async function worker() {
      while (cursor < list.length) {
        const relative = list[cursor++];
        const absolute = assetUrl(relative);
        if (controller.signal.aborted) throw new DOMException('Paused', 'AbortError');
        try {
          if (!await exampleCache.match(absolute)) {
            const response = await fetch(absolute, { signal: controller.signal });
            if (!response.ok) throw new Error(String(response.status));
            await exampleCache.put(absolute, response);
          }
        } catch (error) {
          if (error.name === 'AbortError') throw error;
          failed += 1;
        }
        complete += 1;
        if (complete % 25 === 0 || complete === list.length) {
          const exampleProgress = Math.floor(complete / Math.max(1, list.length) * 8);
          // Reserve 100% for the point after every worker has actually
          // finished. Rounding used to announce completion hundreds of
          // example files too early on the full 6,635-file download.
          els.audioProgress.value = Math.min(99, 92 + exampleProgress);
          els.offlineStatus.textContent = `例句音频 ${complete}/${list.length}，失败 ${failed}。`;
        }
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker));
    els.audioProgress.value = 100;
    els.offlineStatus.textContent = failed ? `双音词典包完成；${failed} 条例句失败，再次点击可补齐。` : '完整英美双音词典包与例句音频已经离线可用。';
    toast(failed ? `主体下载完成，${failed} 条例句待补齐` : '完整双音离线包下载完成');
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.warn(error);
      els.offlineStatus.textContent = `下载中断：${error.message}。再次点击会从已完成分片继续。`;
      toast('下载中断，可再次点击续传');
    }
  } finally {
    if (state.audioPackDownload?.controller === controller) state.audioPackDownload = null;
    button.textContent = els.audioProgress.value >= 100 ? '重新校验完整双音包' : '继续下载完整英美双音包';
  }
}

function bindEvents() {
  els.chapter.addEventListener('change', () => selectChapter(els.chapter.value, true));
  $$('.mode-btn').forEach((button) => button.addEventListener('click', async () => {
    const mode = button.dataset.mode;
    if (mode === 'cn') {
      state.showChinese = !state.showChinese;
      updateStudyPrompt();
    } else if (mode === 'audio') {
      state.autoAudio = !state.autoAudio;
      if (state.autoAudio) playWord(currentWord(), true);
      else state.audio?.pause();
      updateStudyPrompt();
    } else {
      state.randomOrder = !state.randomOrder;
      const current = currentWord();
      const words = currentChapter().words;
      if (state.randomOrder) {
        const remaining = words.filter((word) => word.key !== current?.key);
        state.sequence = current ? [current, ...shuffle(remaining)] : shuffle(words);
        state.index = 0;
        toast('已打乱本单元顺序');
      } else {
        state.sequence = [...words];
        state.index = Math.max(0, words.findIndex((word) => word.key === current?.key));
        toast('已恢复本单元顺序');
      }
      renderStudyWord();
    }
    syncModeButtons();
    await saveProgress();
  }));
  els.input.addEventListener('input', () => renderSlots(currentWord()?.word || '', els.input.value));
  els.input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); submitAnswer(); } });
  els.submit.addEventListener('click', submitAnswer);
  els.star.addEventListener('click', () => toggleStar());
  els.replay.addEventListener('click', () => playWord(currentWord()));
  els.promptAudio.addEventListener('click', () => playWord(currentWord()));
  els.restart.addEventListener('click', async () => { state.index = 0; state.correct = 0; state.wrong = 0; state.sequence = state.randomOrder ? shuffle(currentChapter().words) : [...currentChapter().words]; await saveProgress(); renderStudyWord(); });
  $('#openOverviewBtn').addEventListener('click', () => switchView('overview'));
  $$('.return-study').forEach((button) => button.addEventListener('click', () => switchView('study')));
  $$('.nav-btn').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  $$('.book-card').forEach((button) => button.addEventListener('click', () => { state.activeBook = button.dataset.book; syncBookTabs(); switchView('books'); }));
  $$('.book-tab').forEach((button) => button.addEventListener('click', () => { state.activeBook = button.dataset.book; syncBookTabs(); renderBookList(); }));
  els.startBookReview.addEventListener('click', startBookReview);
  els.overviewSearch.addEventListener('input', renderOverview);
  [['overviewOriginal','original'],['overviewAlpha','alpha'],['overviewShuffle','shuffle']].forEach(([id, order]) => {
    $(`#${id}`).addEventListener('click', () => { state.overviewOrder = order; $$('.overview-controls .filter-btn').forEach((b) => b.classList.toggle('active', b.id === id)); renderOverview(); });
  });
  let dictTimer;
  els.dictSearch.addEventListener('input', () => {
    clearTimeout(dictTimer);
    state.dictionaryLetter = 'all';
    syncDictionaryAlphabet();
    dictTimer = setTimeout(() => renderDictionary(true), 180);
  });
  $$('.dict-filter').forEach((button) => button.addEventListener('click', () => { state.dictionaryFilter = button.dataset.filter; $$('.dict-filter').forEach((b) => b.classList.toggle('active', b === button)); renderDictionary(true); }));
  $$('[data-close-detail]').forEach((item) => item.addEventListener('click', () => closeOverlay()));
  $$('[data-close-lookup]').forEach((item) => item.addEventListener('click', () => closeQuickLookup()));
  $('#downloadCoreAudio').addEventListener('click', downloadCoreAudio);
  $$('.accent-btn').forEach((button) => button.addEventListener('click', async () => { state.accent = button.dataset.accent; $$('.accent-btn').forEach((b) => b.classList.toggle('active', b === button)); await putRecord('settings', { key: 'preferences', accent: state.accent }); }));
  $('#exportBtn').addEventListener('click', async () => {
    const blob = new Blob([await exportBackup()], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `刷词神器备份-${new Date().toISOString().slice(0,10)}.json`; link.click(); URL.revokeObjectURL(link.href);
  });
  $('#importInput').addEventListener('change', async (event) => {
    try { await importBackup(await event.target.files[0].text()); toast('备份已导入，正在刷新'); setTimeout(() => location.reload(), 700); } catch (error) { toast(error.message); }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.quickLookupActive) { closeQuickLookup(); return; }
    if (event.key === 'Escape' && els.overlay.classList.contains('open')) closeOverlay();
    if (!state.quickLookupActive && els.overlay.classList.contains('open') && !event.target.closest('textarea,input')) {
      if (event.key === 'ArrowLeft') { event.preventDefault(); swipeDetail(-1); return; }
      if (event.key === 'ArrowRight') { event.preventDefault(); swipeDetail(1); return; }
    }
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); toggleStar(); }
    if (event.code === 'Space' && state.answered && !state.correctionRequired && !els.overlay.classList.contains('open')) { event.preventDefault(); nextWord(); }
  });
  let detailGesture = null;
  const resetDetailDrag = (snapBack = false) => {
    els.sheet.classList.remove('is-dragging');
    els.sheet.style.removeProperty('--detail-drag-x');
    els.sheet.style.removeProperty('--detail-drag-opacity');
    if (snapBack) {
      els.sheet.classList.add('snap-back');
      setTimeout(() => els.sheet.classList.remove('snap-back'), 190);
    }
  };
  els.sheet.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('textarea,input,button')) return;
    if (event.pointerType === 'mouse' && event.target.closest('p,blockquote,.sense-row,.level-sense,.level-phrases,.detail-extra,.detail-example')) return;
    detailGesture = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now(), horizontal: false };
  });
  els.sheet.addEventListener('pointermove', (event) => {
    if (!detailGesture || event.pointerId !== detailGesture.id) return;
    const dx = event.clientX - detailGesture.x;
    const dy = event.clientY - detailGesture.y;
    if (!detailGesture.horizontal && Math.hypot(dx, dy) > 9) {
      if (Math.abs(dy) >= Math.abs(dx) * 0.9) { detailGesture = null; resetDetailDrag(); return; }
      detailGesture.horizontal = true;
    }
    if (!detailGesture.horizontal) return;
    // Never cancel a real touch scroll. `touch-action: pan-y` leaves horizontal
    // gestures to us while allowing the browser to own vertical scrolling.
    if (event.pointerType === 'mouse') event.preventDefault();
    getSelection()?.removeAllRanges();
    const limited = Math.max(-innerWidth * 0.42, Math.min(innerWidth * 0.42, dx));
    els.sheet.classList.add('is-dragging');
    els.sheet.style.setProperty('--detail-drag-x', `${limited}px`);
    els.sheet.style.setProperty('--detail-drag-opacity', String(Math.max(0.62, 1 - Math.abs(limited) / innerWidth)));
  });
  const finishDetailGesture = (event, cancelled = false) => {
    if (!detailGesture || event.pointerId !== detailGesture.id) return;
    const gesture = detailGesture;
    detailGesture = null;
    const dx = event.clientX - gesture.x;
    const elapsed = Math.max(1, performance.now() - gesture.at);
    const shouldSwitch = !cancelled && gesture.horizontal && (Math.abs(dx) > 58 || Math.abs(dx / elapsed) > 0.48);
    resetDetailDrag(!shouldSwitch);
    if (shouldSwitch) swipeDetail(dx < 0 ? 1 : -1);
  };
  els.sheet.addEventListener('pointerup', (event) => finishDetailGesture(event));
  els.sheet.addEventListener('pointercancel', (event) => finishDetailGesture(event, true));
}

function syncBookTabs() { $$('.book-tab').forEach((button) => button.classList.toggle('active', button.dataset.book === state.activeBook)); }

function registerPwa() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register(assetUrl('sw.js'), { scope: './' }).catch(console.warn);
  let installEvent;
  addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); installEvent = event; els.install.hidden = false; });
  els.install.addEventListener('click', async () => { if (installEvent) { installEvent.prompt(); await installEvent.userChoice; installEvent = null; els.install.hidden = true; } });
}

async function init() {
  try {
    await loadData();
    buildChapterOptions();
    buildDictionaryAlphabet();
    bindEvents();
    setupDictionaryAutoLoad();
    $$('.accent-btn').forEach((button) => button.classList.toggle('active', button.dataset.accent === state.accent));
    await selectChapter(1);
    updateCounts();
    registerPwa();
    syncAudioPackStatus().catch(console.warn);
    els.loading.hidden = true;
    $('#studyView').hidden = false;
    els.syncBadge.textContent = '数据已独立保存';
  } catch (error) {
    console.error(error);
    els.loadingText.textContent = `载入失败：${error.message}。请刷新重试。`;
  }
}

init();
