// ─── State ────────────────────────────────────────────────
let allData = null;
let currentCategoryId = null;
let currentSubcatId = null;
let currentGroupId = null;
let currentQId = null;
let flatStudyQuestions = [];    // all questions at selectedLevel in current scope
let ttsRate = 0.9;
let speakingQId = null;

// Mock
let mockQuestions = [];
let mockAnswers = [];
let mockIdx = 0;
let mockTtsRate = 0.9;

// Speech recognition
let recStudy = null;    // for detail view
let recMock = null;     // for mock view
let isRecStudy = false;
let isRecMock = false;

const STORAGE_KEY = 'opic_data_v5';

// ─── DOM refs ─────────────────────────────────────────────
const screens = {
  home: document.getElementById('screen-home'),
  topic: document.getElementById('screen-topic'),
  list: document.getElementById('screen-list'),
  detail: document.getElementById('screen-detail'),
  edit: document.getElementById('screen-edit'),
  'mock-setup': document.getElementById('screen-mock-setup'),
  mock: document.getElementById('screen-mock'),
  'mock-result': document.getElementById('screen-mock-result'),
};
const appHeader = document.getElementById('app-header');
const headerTitle = document.getElementById('header-title');
const btnBack = document.getElementById('btn-back');
const btnAddQ = document.getElementById('btn-add-q');
const btnEditQ = document.getElementById('btn-edit-q');
const categoryGrid = document.getElementById('category-grid');
const questionList = document.getElementById('question-list');
const detailBody = document.getElementById('detail-body');
const editForm = document.getElementById('edit-form');
const toast = document.getElementById('toast');

// ─── Init ──────────────────────────────────────────────────
async function init() {
  allData = loadData();
  if (!allData) {
    const res = await fetch('data/categories.json');
    allData = await res.json();
  }
  migrateAnswers();
  saveData();
  renderHome();
  showScreen('home');
  initSpeechRecognition();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

function migrateAnswers() {
  for (const cat of allData.categories) {
    for (const s of cat.subcategories) {
      for (const g of s.groups) {
        for (const q of g.questions) {
          if (!Array.isArray(q.answers)) {
            q.answers = q.answer?.trim()
              ? [{ id: 'ans_m_' + q.id, text: q.answer, timestamp: Date.now() }]
              : [];
            delete q.answer;
          }
        }
      }
    }
  }
}

// ─── Persistence ──────────────────────────────────────────
function loadData() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
  catch { return null; }
}
function saveData() { localStorage.setItem(STORAGE_KEY, JSON.stringify(allData)); }

// ─── Screen ───────────────────────────────────────────────
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  if (screens[name]) screens[name].classList.add('active');
  const noHeader = ['mock', 'mock-result'].includes(name);
  appHeader.style.display = noHeader ? 'none' : '';
}

// ─── Home ──────────────────────────────────────────────────
function renderHome() {
  stopTTS();
  headerTitle.textContent = 'OPIc Practice';
  btnBack.style.display = 'none';
  btnAddQ.style.display = 'none';
  btnEditQ.style.display = 'none';

  categoryGrid.innerHTML = '';
  allData.categories.forEach(cat => {
    const allGroups = cat.subcategories.flatMap(s => s.groups);
    const totalQ = allGroups.reduce((n, g) => n + g.questions.length, 0);
    const answeredQ = allGroups.reduce((n, g) =>
      n + g.questions.filter(q => q.answers?.length > 0).length, 0);

    const card = document.createElement('div');
    card.className = 'category-card';
    card.innerHTML = `
      <div class="cat-icon">${cat.icon}</div>
      <div class="cat-name">${cat.name}</div>
      <div class="cat-count">${cat.subcategories.length}개 주제 · ${answeredQ}/${totalQ} 답변</div>
    `;
    card.addEventListener('click', () => openCategory(cat.id));
    categoryGrid.appendChild(card);
  });
}

// ─── Category ─────────────────────────────────────────────
function openCategory(catId) {
  currentCategoryId = catId;
  // 모든 카테고리는 항상 주제 선택 화면 먼저
  openTopicScreen();
}

// ─── Topic Screen (모든 카테고리 공통) ────────────────────
function openTopicScreen() {
  const cat = getCat(currentCategoryId);
  headerTitle.textContent = cat.name;
  btnBack.style.display = '';
  btnAddQ.style.display = 'none';
  btnEditQ.style.display = 'none';

  const grid = document.getElementById('topic-grid');
  grid.innerHTML = '';

  // 서브카테고리가 1개면 바로 목록으로
  if (cat.subcategories.length === 1) {
    openSubcatList(cat.subcategories[0].id);
    return;
  }

  cat.subcategories.forEach(subcat => {
    const allQ = subcat.groups.flatMap(g => g.questions);
    const answeredQ = allQ.filter(q => q.answers?.length > 0).length;

    const card = document.createElement('div');
    card.className = 'topic-card';
    card.innerHTML = `
      <div class="topic-card-icon">${subcat.topic_icon || subcat.icon || '📂'}</div>
      <div class="topic-card-body">
        <div class="topic-card-name">${subcat.topic_label || subcat.name}</div>
        <div class="topic-card-count">${subcat.groups.length}세트 · ${answeredQ}/${allQ.length} 답변</div>
      </div>
      <span class="topic-card-arrow">›</span>
    `;
    card.addEventListener('click', () => openSubcatList(subcat.id));
    grid.appendChild(card);
  });
  showScreen('topic');
}

function openSubcatList(subcatId) {
  currentSubcatId = subcatId;
  const cat = getCat(currentCategoryId);
  const subcat = cat.subcategories.find(s => s.id === subcatId);

  headerTitle.textContent = subcat.topic_label || subcat.name;
  btnBack.style.display = '';
  btnAddQ.style.display = '';
  btnEditQ.style.display = 'none';

  flatStudyQuestions = buildFlatQuestions(currentCategoryId, subcatId);
  renderQuestionList([subcat]);
  showScreen('list');
}

// ─── Question List (레벨별 섹션) ──────────────────────────
function renderQuestionList(subcategories) {
  questionList.innerHTML = '';
  const subcat = subcategories[0];

  [4, 5, 6].forEach(lv => {
    const groups = subcat.groups.filter(g => g.level === lv);
    if (groups.length === 0) return;

    // 레벨 섹션 헤더
    const lvSec = document.createElement('div');
    lvSec.className = `level-section-header lv${lv}`;
    lvSec.innerHTML = `
      <span class="level-section-badge lv${lv}">Level ${lv}</span>
      <span class="level-section-desc">${lvDesc(lv)}</span>
    `;
    questionList.appendChild(lvSec);

    groups.forEach(group => {
      const sec = document.createElement('div');
      sec.className = 'q-list-section';

      const hdr = document.createElement('div');
      hdr.className = 'q-list-group-header';
      hdr.innerHTML = `
        <span class="q-list-group-title">${group.group_title}</span>
        <span class="q-list-group-count">${group.questions.length}개</span>
      `;
      sec.appendChild(hdr);

      group.questions.forEach((q, i) => {
        const item = document.createElement('div');
        item.className = 'q-list-item' + (q.answers?.length > 0 ? ' answered' : '');
        item.innerHTML = `
          <span class="q-list-num">${i + 1}</span>
          <span class="q-list-text">${escapeHtml(q.question)}</span>
          ${q.answers?.length > 0 ? '<span class="q-list-check">✓</span>' : ''}
        `;
        item.addEventListener('click', () => openQuestion(q.id, group.group_id, subcat.id));
        sec.appendChild(item);
      });

      questionList.appendChild(sec);
    });
  });
}

function lvDesc(lv) {
  return lv === 4 ? 'IM3 — 묘사 & 기본 습관' : lv === 5 ? 'IH — 경험 & 비교' : 'AL — 분석 & 의견';
}

// ─── Question Detail (single) ──────────────────────────────
function openQuestion(qId, groupId, subcatId) {
  stopTTS();
  currentQId = qId;
  currentGroupId = groupId;
  currentSubcatId = subcatId;
  renderDetail();
  showScreen('detail');
}

function renderDetail() {
  const q = getQById(currentQId);
  if (!q) return;

  const idx = flatStudyQuestions.findIndex(x => x.id === currentQId);
  const groupInfo = getGroupByQId(currentQId);

  headerTitle.textContent = groupInfo?.group_title || '';
  btnBack.style.display = '';
  btnAddQ.style.display = 'none';
  btnEditQ.style.display = '';

  document.getElementById('btn-prev-q').disabled = idx <= 0;
  document.getElementById('btn-next-q').disabled = idx >= flatStudyQuestions.length - 1;

  const qLevel = groupInfo?.level || '';
  detailBody.innerHTML = `
    <div class="detail-meta">
      ${qLevel ? `<span class="badge badge-level${qLevel}">Level ${qLevel}</span>` : ''}
      <span class="badge badge-cat">${idx + 1} / ${flatStudyQuestions.length}</span>
      ${groupInfo ? `<span class="badge badge-cat">${groupInfo.group_title}</span>` : ''}
    </div>

    <div class="question-card">
      <div class="card-label">Question</div>
      <div class="card-text">${escapeHtml(q.question)}</div>
    </div>

    <div class="tts-row">
      <button class="btn-tts-q" id="btn-tts-q">🔊 질문 듣기</button>
      <div class="tts-rate-wrap">
        <label>속도</label>
        <input type="range" id="tts-rate-slider" min="0.5" max="1.5" step="0.1" value="${ttsRate}">
        <span id="tts-rate-val">${ttsRate}</span>
      </div>
    </div>

    <div class="answer-section">
      <div class="card-label answer-label">My Answer</div>
      <textarea class="answer-textarea" id="ans-input" placeholder="답변을 입력하거나 🎤 버튼으로 말하기..."></textarea>
      <div class="answer-actions">
        <button class="btn-mic-study" id="btn-mic-study">🎤</button>
        <span class="mic-status" id="mic-status-study"></span>
        <button class="btn-clear-ans" id="btn-clear-ans">초기화</button>
        <button class="btn-save-ans" id="btn-save-ans">저장</button>
      </div>
    </div>

    <div class="answer-history" id="answer-history"></div>

    <button class="btn-edit-inline" id="btn-edit-inline">✎ 질문 수정</button>
  `;

  renderSavedAnswer(q);

  document.getElementById('btn-tts-q').addEventListener('click', () => speak(q.question, 'q'));
  document.getElementById('tts-rate-slider').addEventListener('input', e => {
    ttsRate = parseFloat(e.target.value);
    document.getElementById('tts-rate-val').textContent = ttsRate;
  });
  document.getElementById('btn-clear-ans').addEventListener('click', () => {
    document.getElementById('ans-input').value = '';
  });
  document.getElementById('btn-save-ans').addEventListener('click', () => {
    const text = document.getElementById('ans-input').value.trim();
    if (!text) { showToast('답변을 입력해주세요'); return; }
    if (q.answers && q.answers.length > 0) {
      if (!confirm('기존 답변을 덮어쓰시겠습니까?')) return;
      q.answers[0].text = text;
      q.answers[0].timestamp = Date.now();
    } else {
      q.answers = [{ id: 'ans_' + Date.now(), text, timestamp: Date.now() }];
    }
    saveData();
    document.getElementById('ans-input').value = '';
    renderSavedAnswer(q);
    showToast('저장 ✓');
  });
  document.getElementById('btn-edit-inline').addEventListener('click', () => openEditQuestion(currentQId));

  const micBtn = document.getElementById('btn-mic-study');
  if (!recStudy) {
    micBtn.style.opacity = '0.35';
    micBtn.title = '이 브라우저는 음성 입력 미지원';
  } else {
    micBtn.addEventListener('click', () => toggleStudyMic());
  }
}

function renderSavedAnswer(q) {
  const container = document.getElementById('answer-history');
  if (!container) return;
  const ans = q.answers?.[0];
  if (!ans) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = `
    <div class="saved-ans-header">
      <span class="card-label answer-label" style="margin-bottom:0">저장된 답변</span>
      <span class="saved-ans-date">${formatDate(ans.timestamp)}</span>
      <button class="btn-saved-tts" id="btn-saved-tts">🔊</button>
      <button class="btn-saved-edit" id="btn-saved-edit">✎ 수정</button>
    </div>
    <textarea class="answer-textarea saved-ans-textarea" id="saved-ans-text" readonly>${escapeHtml(ans.text)}</textarea>
    <div class="saved-ans-edit-btns" id="saved-ans-edit-btns" style="display:none">
      <button class="btn-primary" id="btn-saved-confirm">저장</button>
      <button class="btn-clear-ans" id="btn-saved-cancel">취소</button>
    </div>
  `;

  document.getElementById('btn-saved-tts').addEventListener('click', () => speak(ans.text, 'saved'));
  document.getElementById('btn-saved-edit').addEventListener('click', () => {
    const ta = document.getElementById('saved-ans-text');
    const editBtns = document.getElementById('saved-ans-edit-btns');
    const btn = document.getElementById('btn-saved-edit');
    if (ta.readOnly) {
      ta.readOnly = false;
      ta.style.borderColor = 'var(--primary)';
      ta.focus();
      ta.selectionStart = ta.selectionEnd = ta.value.length;
      editBtns.style.display = 'flex';
      btn.textContent = '✕';
    } else {
      ta.readOnly = true;
      ta.value = ans.text;
      ta.style.borderColor = '';
      editBtns.style.display = 'none';
      btn.textContent = '✎ 수정';
    }
  });
  document.getElementById('btn-saved-confirm').addEventListener('click', () => {
    const newText = document.getElementById('saved-ans-text').value.trim();
    if (!newText) { showToast('내용을 입력해주세요'); return; }
    ans.text = newText;
    ans.timestamp = Date.now();
    saveData();
    renderSavedAnswer(q);
    showToast('수정됨 ✓');
  });
  document.getElementById('btn-saved-cancel').addEventListener('click', () => renderSavedAnswer(q));
}

function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

document.getElementById('btn-prev-q').addEventListener('click', () => {
  const idx = flatStudyQuestions.findIndex(x => x.id === currentQId);
  if (idx > 0) {
    const prev = flatStudyQuestions[idx - 1];
    currentQId = prev.id;
    currentGroupId = prev.groupId;
    renderDetail();
    detailBody.scrollTop = 0;
  }
});
document.getElementById('btn-next-q').addEventListener('click', () => {
  const idx = flatStudyQuestions.findIndex(x => x.id === currentQId);
  if (idx < flatStudyQuestions.length - 1) {
    const next = flatStudyQuestions[idx + 1];
    currentQId = next.id;
    currentGroupId = next.groupId;
    renderDetail();
    detailBody.scrollTop = 0;
  }
});

// ─── Edit ──────────────────────────────────────────────────
let editMode = null;
let editingQId = null;

btnEditQ.addEventListener('click', () => openEditGroup());
btnAddQ.addEventListener('click', () => {
  const active = Object.keys(screens).find(k => screens[k].classList.contains('active'));
  if (active === 'list') openAddGroup();
  else openAddQuestion();
});

function openAddGroup() {
  editMode = 'add_group';
  headerTitle.textContent = '그룹 추가';
  btnBack.style.display = '';
  btnAddQ.style.display = 'none';
  btnEditQ.style.display = 'none';

  const cat = getCat(currentCategoryId);
  const subcatOptions = cat.subcategories
    .map(s => `<option value="${s.id}" ${s.id === currentSubcatId ? 'selected' : ''}>${s.topic_label || s.name}</option>`).join('');

  editForm.innerHTML = `
    <div class="form-group">
      <label class="form-label">서브카테고리</label>
      <select class="form-select" id="edit-subcat">${subcatOptions}</select>
    </div>
    <div class="form-group">
      <label class="form-label">그룹 제목</label>
      <input class="form-input" id="edit-group-title" placeholder="예: 음악 취향 & 습관">
    </div>
    <div class="form-group">
      <label class="form-label">레벨</label>
      <select class="form-select" id="edit-level">
        <option value="4" ${selectedLevel===4?'selected':''}>Level 4</option>
        <option value="5" ${selectedLevel===5?'selected':''}>Level 5</option>
        <option value="6" ${selectedLevel===6?'selected':''}>Level 6</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">첫 번째 질문</label>
      <textarea class="form-textarea" id="edit-q1" placeholder="Enter the first question..."></textarea>
    </div>
    <div class="btn-row">
      <button class="btn-primary" id="btn-save-edit">저장</button>
    </div>
  `;
  document.getElementById('btn-save-edit').addEventListener('click', saveNewGroup);
  showScreen('edit');
}

function openAddQuestion() {
  editMode = 'add_q';
  headerTitle.textContent = '질문 추가';
  btnBack.style.display = '';
  btnAddQ.style.display = 'none';
  btnEditQ.style.display = 'none';

  editForm.innerHTML = `
    <div class="form-group">
      <label class="form-label">질문 (영어)</label>
      <textarea class="form-textarea" id="edit-question" placeholder="Enter the question..."></textarea>
    </div>
    <div class="btn-row">
      <button class="btn-primary" id="btn-save-edit">저장</button>
    </div>
  `;
  document.getElementById('btn-save-edit').addEventListener('click', saveNewQuestion);
  showScreen('edit');
}

function openEditQuestion(qId) {
  editMode = 'edit_q';
  editingQId = qId;
  headerTitle.textContent = '질문 수정';
  btnBack.style.display = '';
  btnAddQ.style.display = 'none';
  btnEditQ.style.display = 'none';

  const q = getQById(qId);
  editForm.innerHTML = `
    <div class="form-group">
      <label class="form-label">질문 (영어)</label>
      <textarea class="form-textarea" id="edit-question">${escapeHtml(q.question)}</textarea>
    </div>
    <div class="btn-row">
      <button class="btn-primary" id="btn-save-edit">저장</button>
      <button class="btn-danger" id="btn-delete-q">삭제</button>
    </div>
  `;
  document.getElementById('btn-save-edit').addEventListener('click', () => {
    q.question = document.getElementById('edit-question').value.trim();
    if (!q.question) { showToast('질문을 입력해주세요'); return; }
    saveData();
    showToast('저장 ✓');
    renderDetail();
    showScreen('detail');
  });
  document.getElementById('btn-delete-q').addEventListener('click', () => {
    if (!confirm('삭제하시겠습니까?')) return;
    const group = getGroupById(currentGroupId);
    group.questions = group.questions.filter(x => x.id !== qId);
    saveData();
    flatStudyQuestions = buildFlatQuestions(currentCategoryId, currentSubcatId);
    if (flatStudyQuestions.length === 0) { openCategory(currentCategoryId); return; }
    const newIdx = Math.max(0, flatStudyQuestions.length - 1);
    currentQId = flatStudyQuestions[newIdx].id;
    currentGroupId = flatStudyQuestions[newIdx].groupId;
    renderDetail();
    showScreen('detail');
  });
  showScreen('edit');
}

function openEditGroup() {
  editMode = 'edit_group';
  headerTitle.textContent = '그룹 수정';
  btnBack.style.display = '';
  btnAddQ.style.display = 'none';
  btnEditQ.style.display = 'none';

  const group = getGroupById(currentGroupId);
  editForm.innerHTML = `
    <div class="form-group">
      <label class="form-label">그룹 제목</label>
      <input class="form-input" id="edit-group-title" value="${escapeHtml(group.group_title)}">
    </div>
    <div class="btn-row">
      <button class="btn-primary" id="btn-save-edit">저장</button>
      <button class="btn-danger" id="btn-delete-group">그룹 삭제</button>
    </div>
  `;
  document.getElementById('btn-save-edit').addEventListener('click', () => {
    const title = document.getElementById('edit-group-title').value.trim();
    if (!title) { showToast('제목을 입력해주세요'); return; }
    group.group_title = title;
    saveData();
    showToast('저장 ✓');
    renderDetail();
    showScreen('detail');
  });
  document.getElementById('btn-delete-group').addEventListener('click', () => {
    if (!confirm('그룹 전체를 삭제하시겠습니까?')) return;
    const cat = getCat(currentCategoryId);
    for (const s of cat.subcategories) {
      s.groups = s.groups.filter(g => g.group_id !== currentGroupId);
    }
    saveData();
    flatStudyQuestions = buildFlatQuestions(currentCategoryId, currentSubcatId);
    showToast('삭제됨');
    if (currentCategoryId === 'main_survey') openSubcatList(currentSubcatId);
    else openCategory(currentCategoryId);
  });
  showScreen('edit');
}

function saveNewGroup() {
  const subcatId = document.getElementById('edit-subcat').value;
  const title = document.getElementById('edit-group-title').value.trim();
  const level = parseInt(document.getElementById('edit-level').value);
  const q1 = document.getElementById('edit-q1').value.trim();
  if (!title || !q1) { showToast('모두 입력해주세요'); return; }

  const cat = getCat(currentCategoryId);
  const subcat = cat.subcategories.find(s => s.id === subcatId);
  subcat.groups.push({ group_id: 'cg_' + Date.now(), group_title: title, level,
    questions: [{ id: 'cq_' + Date.now(), question: q1, answers: [] }] });
  saveData();
  showToast('추가됨');
  if (currentCategoryId === 'main_survey') openSubcatList(subcatId);
  else openCategory(currentCategoryId);
}

function saveNewQuestion() {
  const question = document.getElementById('edit-question').value.trim();
  if (!question) { showToast('질문을 입력해주세요'); return; }

  const group = getGroupById(currentGroupId);
  const newQ = { id: 'cq_' + Date.now(), question, answers: [] };
  group.questions.push(newQ);
  saveData();
  flatStudyQuestions = buildFlatQuestions(currentCategoryId, currentSubcatId);
  currentQId = newQ.id;
  currentGroupId = group.group_id;
  showToast('추가됨');
  renderDetail();
  showScreen('detail');
}

// ─── Back button ───────────────────────────────────────────
btnBack.addEventListener('click', () => {
  stopTTS(); stopStudyMic();
  const active = Object.keys(screens).find(k => screens[k].classList.contains('active'));
  if (active === 'mock-setup') { renderHome(); showScreen('home'); }
  else if (active === 'edit') {
    if (editMode === 'add_group') {
      if (currentCategoryId === 'main_survey') openSubcatList(currentSubcatId);
      else openCategory(currentCategoryId);
    } else if (editMode === 'add_q' || editMode === 'edit_q' || editMode === 'edit_group') {
      renderDetail(); showScreen('detail');
    } else { renderHome(); showScreen('home'); }
  } else if (active === 'detail') {
    openSubcatList(currentSubcatId);
  } else if (active === 'list') {
    const cat = getCat(currentCategoryId);
    if (cat && cat.subcategories.length > 1) openTopicScreen();
    else { renderHome(); showScreen('home'); }
  } else if (active === 'topic') {
    renderHome(); showScreen('home');
  } else {
    renderHome(); showScreen('home');
  }
});

// ─── TTS ───────────────────────────────────────────────────
function speak(text, trackId, rate) {
  if (!text?.trim()) return;
  stopTTS();
  speakingQId = trackId;
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'en-US';
  utt.rate = rate ?? ttsRate;
  const voices = speechSynthesis.getVoices();
  const v = voices.find(v => v.lang.startsWith('en') &&
    (v.name.includes('Samantha') || v.name.includes('Google US') || v.name.includes('Aaron')))
    || voices.find(v => v.lang === 'en-US') || voices.find(v => v.lang.startsWith('en'));
  if (v) utt.voice = v;
  utt.onend = () => { speakingQId = null; };
  speechSynthesis.speak(utt);
}

function stopTTS() {
  speechSynthesis.cancel();
  speakingQId = null;
}

if ('speechSynthesis' in window) {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener('voiceschanged', () => speechSynthesis.getVoices());
}

// ─── Speech Recognition ────────────────────────────────────
function initSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;

  // Study mic
  recStudy = new SR();
  recStudy.lang = 'en-US';
  recStudy.continuous = false;
  recStudy.interimResults = true;
  recStudy.onstart = () => {
    isRecStudy = true;
    const btn = document.getElementById('btn-mic-study');
    if (btn) { btn.classList.add('recording'); btn.textContent = '⏹'; }
    const st = document.getElementById('mic-status-study');
    if (st) st.textContent = '🔴 녹음 중...';
  };
  recStudy.onresult = e => {
    const txt = [...e.results].map(r => r[0].transcript).join('');
    const ta = document.getElementById('ans-input');
    if (ta) ta.value = txt;
  };
  recStudy.onend = () => {
    isRecStudy = false;
    const btn = document.getElementById('btn-mic-study');
    if (btn) { btn.classList.remove('recording'); btn.textContent = '🎤'; }
    const st = document.getElementById('mic-status-study');
    if (st) st.textContent = '';
  };
  recStudy.onerror = () => recStudy.onend();

  // Mock mic
  recMock = new SR();
  recMock.lang = 'en-US';
  recMock.continuous = false;
  recMock.interimResults = true;
  recMock.onstart = () => {
    isRecMock = true;
    document.getElementById('btn-mic-mock').classList.add('recording');
    document.getElementById('mic-status-mock').textContent = '🔴 녹음 중...';
  };
  recMock.onresult = e => {
    document.getElementById('mock-textarea').value =
      [...e.results].map(r => r[0].transcript).join('');
  };
  recMock.onend = () => {
    isRecMock = false;
    document.getElementById('btn-mic-mock').classList.remove('recording');
    document.getElementById('mic-status-mock').textContent = '';
  };
  recMock.onerror = () => recMock.onend();

  document.getElementById('btn-mic-mock').addEventListener('click', () => {
    if (isRecMock) { recMock.stop(); } else { speechSynthesis.cancel(); recMock.start(); }
  });
}

function toggleStudyMic() {
  if (!recStudy) return;
  if (isRecStudy) { recStudy.stop(); }
  else { speechSynthesis.cancel(); recStudy.start(); }
}

function stopStudyMic() {
  if (recStudy && isRecStudy) recStudy.stop();
}

// ─── Mock Setup ────────────────────────────────────────────
document.getElementById('btn-start-mock').addEventListener('click', openMockSetup);

function openMockSetup() {
  stopTTS();
  headerTitle.textContent = '모의시험';
  btnBack.style.display = '';
  btnAddQ.style.display = 'none';
  btnEditQ.style.display = 'none';

  const cat = getCat('main_survey');
  const list = document.getElementById('topic-check-list');
  list.innerHTML = '';
  cat.subcategories.forEach(s => {
    const label = document.createElement('label');
    label.className = 'check-item';
    label.innerHTML = `
      <input type="checkbox" value="${s.id}" checked>
      <span>${s.topic_icon || ''} ${s.topic_label || s.name}</span>
    `;
    list.appendChild(label);
  });

  showScreen('mock-setup');
}

document.getElementById('btn-mock-go').addEventListener('click', () => {
  const level = parseInt(document.querySelector('#mock-level-radio input:checked').value);
  const selectedTopics = [...document.querySelectorAll('#topic-check-list input:checked')].map(c => c.value);

  if (selectedTopics.length === 0) { showToast('주제를 하나 이상 선택해주세요'); return; }

  mockQuestions = buildMockQuestions(level, selectedTopics);
  mockAnswers = new Array(mockQuestions.length).fill('');
  mockIdx = 0;
  startMockExam();
});

// ─── Mock Question Build ───────────────────────────────────
function buildMockQuestions(level, topicIds) {
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const getGroupsAt = (catId, subcatId, lv) => {
    const cat = getCat(catId);
    const subcats = subcatId ? cat.subcategories.filter(s => s.id === subcatId) : cat.subcategories;
    return subcats.flatMap(s => s.groups.filter(g => g.level === lv));
  };
  const tag = (questions, phase, groupTitle) =>
    questions.map(q => ({ ...q, phase, group_title: groupTitle }));

  let all = [];

  // 1. Background (3 q) - from 자기소개
  const bgGroups = getGroupsAt('frequent', 'self_home', level);
  if (bgGroups.length) {
    const g = pick(bgGroups);
    all.push(...tag(g.questions, '배경 질문', g.group_title));
  }

  // 2. Main survey - up to 2 selected topics (3+3 = 6 q)
  const mainCat = getCat('main_survey');
  const shuffledTopics = [...topicIds].sort(() => Math.random() - 0.5).slice(0, 2);
  shuffledTopics.forEach(subcatId => {
    const groups = getGroupsAt('main_survey', subcatId, level);
    if (groups.length) {
      const g = pick(groups);
      const subcat = mainCat.subcategories.find(s => s.id === subcatId);
      all.push(...tag(g.questions, subcat.topic_label || subcat.name, g.group_title));
    }
  });

  // 3. Surprise (3 q) - if only 1 main topic, add extra surprise set
  const surpriseGroups = getGroupsAt('surprise', null, level);
  const shuffledSurprise = [...surpriseGroups].sort(() => Math.random() - 0.5);
  const surpriseCount = shuffledTopics.length < 2 ? 2 : 1;
  shuffledSurprise.slice(0, surpriseCount).forEach(g => {
    all.push(...tag(g.questions, '돌발질문', g.group_title));
  });

  // 4. Roleplay (3 q)
  const rpGroups = getGroupsAt('roleplay', null, level);
  if (rpGroups.length) {
    const g = pick(rpGroups);
    all.push(...tag(g.questions, '롤플레이', g.group_title));
  }

  return all;
}

// ─── Mock Exam ─────────────────────────────────────────────
function startMockExam() {
  showScreen('mock');
  renderMockQuestion();
  setTimeout(() => speakMock(mockQuestions[0]?.question), 600);

  document.getElementById('btn-mock-tts').onclick = () => speakMock(mockQuestions[mockIdx]?.question);
  document.getElementById('mock-tts-rate').oninput = e => {
    mockTtsRate = parseFloat(e.target.value);
    document.getElementById('mock-tts-rate-val').textContent = mockTtsRate;
  };
  document.getElementById('btn-mock-next').onclick = mockNext;
  document.getElementById('btn-mock-skip').onclick = mockNext;
}

function renderMockQuestion() {
  const q = mockQuestions[mockIdx];
  const total = mockQuestions.length;
  document.getElementById('mock-progress-fill').style.width = ((mockIdx + 1) / total * 100) + '%';
  document.getElementById('mock-phase-label').textContent = `📌 ${q.phase} — ${q.group_title}`;
  document.getElementById('mock-q-counter').textContent = `${mockIdx + 1} / ${total}`;
  document.getElementById('mock-question-card').textContent = q.question;
  document.getElementById('mock-textarea').value = mockAnswers[mockIdx] || '';
}

function mockNext() {
  stopTTS();
  if (recMock && isRecMock) recMock.stop();
  mockAnswers[mockIdx] = document.getElementById('mock-textarea').value;
  if (mockIdx >= mockQuestions.length - 1) { showMockResult(); return; }
  mockIdx++;
  renderMockQuestion();
  setTimeout(() => speakMock(mockQuestions[mockIdx].question), 400);
}

function speakMock(text) {
  if (!text) return;
  speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'en-US';
  utt.rate = mockTtsRate;
  const voices = speechSynthesis.getVoices();
  const v = voices.find(v => v.lang.startsWith('en') &&
    (v.name.includes('Samantha') || v.name.includes('Google US')))
    || voices.find(v => v.lang === 'en-US') || voices.find(v => v.lang.startsWith('en'));
  if (v) utt.voice = v;
  speechSynthesis.speak(utt);
}

// ─── Mock Result ───────────────────────────────────────────
function showMockResult() {
  stopTTS();
  showScreen('mock-result');
  const answered = mockAnswers.filter(a => a?.trim()).length;
  document.getElementById('result-sub').textContent =
    `${mockQuestions.length}문제 중 ${answered}문제 답변 완료`;

  const list = document.getElementById('result-list');
  list.innerHTML = '';
  let lastPhase = '';
  mockQuestions.forEach((q, i) => {
    if (q.phase !== lastPhase) {
      lastPhase = q.phase;
      const ph = document.createElement('div');
      ph.className = 'result-phase';
      ph.textContent = q.phase;
      list.appendChild(ph);
    }
    const item = document.createElement('div');
    item.className = 'result-item' + (mockAnswers[i]?.trim() ? ' answered' : '');
    item.innerHTML = `
      <div class="result-q-meta"><span class="result-q-group">${q.group_title}</span></div>
      <div class="result-q-text">${escapeHtml(q.question)}</div>
      ${mockAnswers[i]?.trim()
        ? `<div class="result-ans">${escapeHtml(mockAnswers[i])}</div>`
        : `<div class="result-no-ans">답변 없음</div>`}
    `;
    list.appendChild(item);
  });
}

document.getElementById('btn-result-home').addEventListener('click', () => { renderHome(); showScreen('home'); });
document.getElementById('btn-result-retry').addEventListener('click', openMockSetup);

// ─── Helpers ───────────────────────────────────────────────
function getCat(id) { return allData.categories.find(c => c.id === id); }

function buildFlatQuestions(catId, subcatId) {
  const cat = getCat(catId);
  const subcats = subcatId
    ? cat.subcategories.filter(s => s.id === subcatId)
    : cat.subcategories;
  // 레벨 4→5→6 순서로 정렬
  return subcats.flatMap(s =>
    [4, 5, 6].flatMap(lv =>
      s.groups.filter(g => g.level === lv).flatMap(g =>
        g.questions.map(q => ({ ...q, groupId: g.group_id, subcatId: s.id }))
      )
    )
  );
}

function getQById(qId) {
  for (const cat of allData.categories) {
    for (const s of cat.subcategories) {
      for (const g of s.groups) {
        const q = g.questions.find(x => x.id === qId);
        if (q) return q;
      }
    }
  }
  return null;
}

function getGroupById(groupId) {
  for (const cat of allData.categories) {
    for (const s of cat.subcategories) {
      const g = s.groups.find(x => x.group_id === groupId);
      if (g) return g;
    }
  }
  return null;
}

function getGroupByQId(qId) {
  for (const cat of allData.categories) {
    for (const s of cat.subcategories) {
      for (const g of s.groups) {
        if (g.questions.find(x => x.id === qId)) return g;
      }
    }
  }
  return null;
}

function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escapeAttr(s) {
  if (!s) return '';
  return s.replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
}

init();
