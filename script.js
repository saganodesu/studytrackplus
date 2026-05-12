function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}
function applyDeviceLayout() {
    if (isMobileDevice()) {
        document.body.classList.add('mobile-mode');
        document.body.classList.remove('pc-mode');
    } else {
        document.body.classList.add('pc-mode');
        document.body.classList.remove('mobile-mode');
    }
}
applyDeviceLayout();

const firebaseConfig = {
    apiKey: "AIzaSyC_NUKXsLJFdj5X6W2YbXWbwOkheuUhevA",
    authDomain: "studytrackplus.firebaseapp.com",
    databaseURL: "https://studytrackplus-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "studytrackplus",
    storageBucket: "studytrackplus.firebasestorage.app",
    messagingSenderId: "954493374254",
    appId: "1:954493374254:web:00d4eba0371e58cb82f4bf",
    measurementId: "G-MS57LRBR8Y"
};

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { getAuth, signInAnonymously, GoogleAuthProvider, signInWithPopup, linkWithCredential, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

let currentUser = null;
let unsubscribe = null;
let isLocalUpdating = false;

const STORAGE_KEYS = {
    sessions: "study_sessions_v3",
    subjects: "custom_subjects_v3",
    diary: "daily_diary_v3",
    books: "study_books_v3",
    progress: "book_progress_v3",
    goal: "daily_goal_v3"
};

let sessions = [];
let customSubjects = ["数学", "英語", "理科", "社会", "国語", "プログラミング", "その他"];
let diaryNotes = {};
let books = [];
let cumulativeProgress = {};
let subjectColorMap = new Map();
const defaultColors = ['#2a9d8f', '#e9c46a', '#f4a261', '#e76f51', '#6c9ebf', '#9c89b8', '#6d6875', '#4c9aff', '#ff6b6b'];
let bookChartInstances = {};

let timerStartTime = null, timerPausedTime = null, timerInterval = null, isTimerRunning = false;
let timerMode = "countdown", targetSeconds = 25 * 60, autoLogTriggered = false, alarmEnabled = true;
let audioContext = null, pomodoroFocusSeconds = 25 * 60, pomodoroBreakSeconds = 5 * 60;
let isPomodoroFocus = true, pomodoroCycleCount = 0, concentrationMode = true;
const studyOverlay = document.getElementById('studyOverlay');
const studyEndBtn = document.getElementById('studyEndBtn');

let statsDailyChart, statsSubjectChart;
let statsDailyChartMobile, statsSubjectChartMobile;
let statsPeriod = "week", statsPeriodOffset = 0;
let currentEditBookId = null, currentEditDate = null;
if (!window.bookDisplayMonths) window.bookDisplayMonths = {};

function getLocalDateStr(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
function getTodayLocalStr() { return getLocalDateStr(new Date()); }
function parseLocalDate(dateStr) { const [y, m, d] = dateStr.split('-').map(Number); return new Date(y, m - 1, d); }
function formatMinutesToHours(minutes) { const h = Math.floor(minutes / 60), m = minutes % 60; if (h === 0) return `${m}分`; if (m === 0) return `${h}時間`; return `${h}時間${m}分`; }
function formatMinutesToHoursShort(minutes) { if (minutes < 60) return minutes + '分'; const h = Math.floor(minutes / 60), m = minutes % 60; return m === 0 ? h + '時間' : h + '時間' + m + '分'; }
function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
function getColorForSubject(subject) { if (!subjectColorMap.has(subject)) subjectColorMap.set(subject, defaultColors[subjectColorMap.size % defaultColors.length]); return subjectColorMap.get(subject); }
function showToast(msg, isErr = false) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; if (isErr) t.style.background = '#e76f51'; document.body.appendChild(t); setTimeout(() => t.remove(), 2500); }

function getCumulative(bookId, dateStr) { const prog = cumulativeProgress[bookId] || {}; if (prog[dateStr] !== undefined) return prog[dateStr]; const pastDates = Object.keys(prog).filter(d => d <= dateStr).sort(); return pastDates.length ? prog[pastDates[pastDates.length - 1]] : 0; }
function getPreviousCumulative(bookId, dateStr) { const prog = cumulativeProgress[bookId] || {}; const pastDates = Object.keys(prog).filter(d => d < dateStr).sort(); return pastDates.length ? prog[pastDates[pastDates.length - 1]] : 0; }
function getYesterdayStr() { const d = new Date(); d.setDate(d.getDate() - 1); return getLocalDateStr(d); }
function getTodayTargetPages(book) { const yesterdayCum = getCumulative(book.id, getYesterdayStr()); const dailyTarget = book.dailyTarget || 0; if (dailyTarget === 0) return 0; return yesterdayCum + dailyTarget; }
function isTodayTargetAchieved(book) { const todayCum = getCumulative(book.id, getTodayLocalStr()); const target = getTodayTargetPages(book); return target > 0 && todayCum >= target; }
function saveBooks() { localStorage.setItem(STORAGE_KEYS.books, JSON.stringify(books)); }
function saveCumulativeProgress() { localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify(cumulativeProgress)); }

function addStudyRecord(subject, minutes, dateStr, startTime) {
    if (!subject || minutes <= 0) { alert("勉強時間は1分以上"); return false; }
    if (!dateStr) dateStr = getTodayLocalStr();
    if (!startTime) startTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    sessions.push({ id: Date.now() + Math.random() * 10000, dateStr, startTime, subject, minutes: Math.round(minutes) });
    saveAllData(); refreshAllUI(); syncToCloud(); return true;
}
function deleteSessionById(id) { sessions = sessions.filter(s => s.id !== id); saveAllData(); refreshAllUI(); syncToCloud(); }
function clearAllHistory() { if (confirm("全ての学習履歴を削除しますか？")) { sessions = []; saveAllData(); refreshAllUI(); syncToCloud(); } }

function renderHistoryTable() {
    const tbody = document.getElementById('historyTbody');
    if (tbody) { /* 既存のまま */ }
    const tbodyMobile = document.getElementById('historyTbodyMobile');
    if (tbodyMobile) { /* 既存のまま */ }
    // 既存のコードをそのまま使用
    if (tbody) {
        if (sessions.length === 0) { tbody.innerHTML = '<tr><td colspan="5">記録がありません</td></tr>'; } else {
            const sorted = [...sessions].sort((a, b) => new Date(b.dateStr + "T" + b.startTime) - new Date(a.dateStr + "T" + a.startTime));
            tbody.innerHTML = "";
            for (let s of sorted) {
                const row = tbody.insertRow();
                row.insertCell(0).textContent = s.dateStr; row.insertCell(1).textContent = s.startTime; row.insertCell(2).textContent = s.subject; row.insertCell(3).textContent = formatMinutesToHours(s.minutes);
                const btn = document.createElement('button'); btn.textContent = '削除'; btn.className = 'delete-btn'; btn.onclick = () => deleteSessionById(s.id); row.insertCell(4).appendChild(btn);
            }
        }
    }
    if (tbodyMobile) {
        if (sessions.length === 0) { tbodyMobile.innerHTML = '<tr><td colspan="5">記録がありません</td></tr>'; } else {
            const sorted = [...sessions].sort((a, b) => new Date(b.dateStr + "T" + b.startTime) - new Date(a.dateStr + "T" + a.startTime));
            tbodyMobile.innerHTML = "";
            for (let s of sorted) {
                const row = tbodyMobile.insertRow();
                row.insertCell(0).textContent = s.dateStr; row.insertCell(1).textContent = s.startTime; row.insertCell(2).textContent = s.subject; row.insertCell(3).textContent = formatMinutesToHours(s.minutes);
                const btn = document.createElement('button'); btn.textContent = '削除'; btn.className = 'delete-btn'; btn.onclick = () => deleteSessionById(s.id); row.insertCell(4).appendChild(btn);
            }
        }
    }
}

function updateSubjectSelects() {
    const selects = ['timerSubjectSelect', 'manualSubject', 'timerSubjectSelectMobile', 'manualSubjectMobile'];
    selects.forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = customSubjects.map(s => `<option value="${s}">${s}</option>`).join(''); });
}

function renderSubjectTags() { /* 変更なし */ }
function addSubject() { /* 変更なし */ }
function removeSubject(subject) { /* 変更なし */ }

function saveDiaryToLocal() { localStorage.setItem(STORAGE_KEYS.diary, JSON.stringify(diaryNotes)); }
function saveCurrentDiary() { /* 変更なし */ }
function deleteCurrentDiary() { /* 変更なし */ }
function renderDiaryList() { /* 変更なし */ }
function loadDiaryForDate(dateStr) { /* 変更なし */ }

function addBook() {
    const name = document.getElementById('newBookName')?.value.trim(); const total = parseInt(document.getElementById('newBookTotal')?.value);
    if (!name) { showToast("参考書名を入力してください", true); return; }
    if (isNaN(total) || total <= 0) { showToast("総ページ数を正しく入力してください", true); return; }
    books.push({ id: Date.now(), name, totalPages: total, dailyTarget: 0 }); saveBooks(); renderBooks(); if (document.getElementById('newBookName')) document.getElementById('newBookName').value = ''; if (document.getElementById('newBookTotal')) document.getElementById('newBookTotal').value = '200'; showToast(`参考書「${name}」を追加しました`); syncToCloud();
}

function renderCalendarForBook(bookId) { /* 変更なし */ }
function openEditModal(bookId, dateStr) { /* 変更なし */ }
function closeEditModal() { /* 変更なし */ }
function saveEditedData() { /* 変更なし */ }

function renderBooks() {
    const container = document.getElementById('bookList');
    const containerMobile = document.getElementById('bookListMobile');
    if (books.length === 0) {
        const emptyHtml = '<div style="text-align:center;padding:20px;color:#94a3b8;">参考書が登録されていません</div>';
        if (container) container.innerHTML = emptyHtml; if (containerMobile) containerMobile.innerHTML = emptyHtml; return;
    }
    const today = getTodayLocalStr();
    const sortedBooks = [...books].sort((a, b) => { const aCompleted = getCumulative(a.id, today) >= a.totalPages; const bCompleted = getCumulative(b.id, today) >= b.totalPages; if (aCompleted !== bCompleted) return aCompleted ? 1 : -1; return a.id - b.id; });
    const html = sortedBooks.map(book => {
        const current = getCumulative(book.id, today); const percent = book.totalPages > 0 ? (current / book.totalPages) * 100 : 0; const fullyCompleted = current >= book.totalPages; const dailyAchieved = !fullyCompleted && isTodayTargetAchieved(book);
        return `<div class="book-item ${fullyCompleted ? 'fully-completed' : (dailyAchieved ? 'daily-achieved' : '')}" data-id="${book.id}">
            <div class="book-header" data-id="${book.id}"><div class="book-title">${escapeHtml(book.name)}</div><div class="book-progress-bar"><div class="book-progress-fill" style="width: ${percent}%;"></div></div><div class="book-summary">${current} / ${book.totalPages}</div></div>
            <div class="book-detail" style="display:none;" data-detail="${book.id}"> /* ... */ </div></div>`;
    }).join('');
    if (container) container.innerHTML = html; if (containerMobile) containerMobile.innerHTML = html;
    // 各イベントリスナーは既存のものをそのまま適用
    document.querySelectorAll('.book-header').forEach(header => { /* ... */ });
    document.querySelectorAll('.set-target-btn').forEach(btn => { /* ... */ });
    // 以下略
}

function computeStats() { /* 変更なし */ }
function updateStatsAndGoal() { /* 変更なし */ }
function updateStatsDailyChart() { /* 変更なし */ }
function updateStatsSubjectChart() { /* 変更なし */ }
function renderBooksProgressGrid() { /* 変更なし */ }
function refreshAllUI() { renderHistoryTable(); updateStatsAndGoal(); renderDiaryList(); renderBooks(); updateSubjectSelects(); renderSubjectTags(); updateStatsDailyChart(); updateStatsSubjectChart(); renderBooksProgressGrid(); }
function saveAllData() { /* 変更なし */ }
function loadAllData() { /* 変更なし */ }

// タイマー関連（すべて既存のまま）
let timerIntervalId = null;
function getRemainingSeconds() { /* 変更なし */ }
function updateTimerDisplay() { /* 変更なし */ }
function playShortAlarm() { /* 変更なし */ }
function startTimer() { /* 変更なし */ }
function pauseTimer() { /* 変更なし */ }
function resetTimer() { /* 変更なし */ }
function manualStudyEnd() { /* 変更なし */ }
function setCountdownTarget(minutes) { /* 変更なし */ }
function setPomodoroTimes(focus, brk) { /* 変更なし */ }
function switchMode(mode) { /* 変更なし */ }
function logCurrentTimer() { /* 変更なし */ }
function handleManualAdd() { /* 変更なし */ }

let settings = { textSize: '21px', darkMode: false, alarmSound: true, concentrationMode: true };
function loadSettings() { /* 変更なし */ }
function applySettings() { /* 変更なし */ }
function setDarkMode(enabled) { /* 変更なし */ }
function setAlarmSound(enabled) { /* 変更なし */ }
function setConcentrationMode(enabled) { /* 変更なし */ }

function exportData() { /* 変更なし */ }
function importData(file) { /* 変更なし */ }
function clearAllData() { /* 変更なし */ }
function resetSettings() { /* 変更なし */ }

async function syncToCloud() { /* 変更なし */ }
async function syncFromCloud() { /* 変更なし */ }
function startRealtimeSync() { /* 変更なし */ }
function updateUserUI() { /* 変更なし */ }
async function upgradeToGoogle() { /* 変更なし */ }
async function loadOrMigrateData() { /* 変更なし */ }

function getBookDateRange(bookId) { /* 変更なし */ }

function initPCTabs() {
    document.querySelectorAll('.sidebar-nav-item[data-tab-pc]').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.sidebar-nav-item[data-tab-pc]').forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            const tabId = item.dataset.tabPc;
            document.querySelectorAll('.pc-tab-content').forEach(tab => tab.classList.remove('active'));
            const target = document.getElementById(tabId);
            if (target) target.classList.add('active');
            if (tabId === 'stats-tab-pc') { setTimeout(() => { updateStatsDailyChart(); updateStatsSubjectChart(); }, 100); }
            if (tabId === 'books-tab-pc') { setTimeout(() => renderBooksProgressGrid(), 100); }
        });
    });
}

function initMobileTabs() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            const tabId = item.dataset.tabMobile;
            document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
            const target = document.getElementById(tabId);
            if (target) target.classList.add('active');
            if (tabId === 'stats-tab-mobile') { setTimeout(() => { updateStatsDailyChart(); updateStatsSubjectChart(); }, 100); }
        });
    });
}

// ★ サイドバーセクション開閉 → モーダル表示に変更
function initSidebarSections() {
    const manualModal = document.getElementById('manualRecordModal');
    const bookModal = document.getElementById('bookManagementModal');

    const openModal = (modal) => { if (modal) modal.style.display = 'flex'; };
    const closeModal = (modal) => { if (modal) modal.style.display = 'none'; };

    document.querySelector('[data-sidebar-section="manual-record-modal"]')?.addEventListener('click', () => openModal(manualModal));
    document.querySelector('[data-sidebar-section="book-management-modal"]')?.addEventListener('click', () => {
        openModal(bookModal);
        renderBooks(); // 開いたときに最新の状態に更新
    });

    document.getElementById('closeManualModalBtn')?.addEventListener('click', () => closeModal(manualModal));
    document.getElementById('closeBookModalBtn')?.addEventListener('click', () => closeModal(bookModal));

    window.addEventListener('click', (e) => {
        if (e.target === manualModal) closeModal(manualModal);
        if (e.target === bookModal) closeModal(bookModal);
    });
}

function updateDateTime() { /* 変更なし */ }

onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) { updateUserUI(); startRealtimeSync(); await loadOrMigrateData(); }
    else signInAnonymously(auth);
});

function init() {
    loadSettings(); loadAllData(); refreshAllUI();
    const todayStr = getTodayLocalStr(); const diaryDate = document.getElementById('diaryDate'); if (diaryDate) diaryDate.value = todayStr;
    loadDiaryForDate(todayStr); updateDateTime(); setInterval(updateDateTime, 1000);
    initPCTabs(); initMobileTabs(); initSidebarSections();

    const btnIds = ['startTimerBtn', 'pauseTimerBtn', 'resetTimerBtn', 'logTimerBtn', 'addManualRecordBtn', 'clearAllHistoryBtn', 'setCustomTimeBtn', 'setPomodoroTimeBtn', 'addSubjectBtn', 'saveDiaryBtn', 'deleteDiaryBtn', 'addBookBtn', 'darkModeToggle', 'hamburgerBtn', 'closeSettingsBtn', 'resetSettingsBtn', 'clearAllDataBtn', 'exportDataBtn', 'importDataBtn', 'syncToCloudBtn', 'syncFromCloudBtn', 'googleLoginBtnPC', 'saveEditBtn', 'cancelEditBtn', 'closeManualModalBtn', 'closeBookModalBtn'];
    btnIds.forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.hasListener) {
            el.hasListener = true;
            if (id === 'startTimerBtn') el.onclick = startTimer;
            else if (id === 'pauseTimerBtn') el.onclick = pauseTimer;
            else if (id === 'resetTimerBtn') el.onclick = resetTimer;
            else if (id === 'logTimerBtn') el.onclick = logCurrentTimer;
            else if (id === 'addManualRecordBtn') el.onclick = handleManualAdd;
            else if (id === 'clearAllHistoryBtn') el.onclick = clearAllHistory;
            else if (id === 'setCustomTimeBtn') el.onclick = () => { const m = parseInt(document.getElementById('customMinutes')?.value); if (m > 0) setCountdownTarget(m); };
            else if (id === 'setPomodoroTimeBtn') el.onclick = () => { const f = parseInt(document.getElementById('customFocusMinutes')?.value), b = parseInt(document.getElementById('customBreakMinutes')?.value); if (f > 0 && b > 0) setPomodoroTimes(f, b); };
            else if (id === 'addSubjectBtn') el.onclick = addSubject;
            else if (id === 'saveDiaryBtn') el.onclick = saveCurrentDiary;
            else if (id === 'deleteDiaryBtn') el.onclick = deleteCurrentDiary;
            else if (id === 'addBookBtn') el.onclick = addBook;
            else if (id === 'darkModeToggle') el.onclick = () => setDarkMode(!settings.darkMode);
            else if (id === 'hamburgerBtn') el.onclick = () => document.getElementById('settingsModal').style.display = 'flex';
            else if (id === 'closeSettingsBtn') el.onclick = () => document.getElementById('settingsModal').style.display = 'none';
            else if (id === 'resetSettingsBtn') el.onclick = resetSettings;
            else if (id === 'clearAllDataBtn') el.onclick = clearAllData;
            else if (id === 'exportDataBtn') el.onclick = exportData;
            else if (id === 'importDataBtn') el.onclick = () => document.getElementById('fileInput').click();
            else if (id === 'syncToCloudBtn') el.onclick = syncToCloud;
            else if (id === 'syncFromCloudBtn') el.onclick = syncFromCloud;
            else if (id === 'googleLoginBtnPC') el.onclick = upgradeToGoogle;
            else if (id === 'saveEditBtn') el.onclick = saveEditedData;
            else if (id === 'cancelEditBtn') el.onclick = closeEditModal;
            else if (id === 'closeManualModalBtn') el.onclick = () => document.getElementById('manualRecordModal').style.display = 'none';
            else if (id === 'closeBookModalBtn') el.onclick = () => document.getElementById('bookManagementModal').style.display = 'none';
        }
    });

    // 各種初期化処理（変更なし）
    const fileInput = document.getElementById('fileInput'); if (fileInput) fileInput.onchange = (e) => { if (e.target.files.length) importData(e.target.files[0]); e.target.value = ''; };
    const dailyGoal = document.getElementById('dailyGoalInput'); if (dailyGoal) dailyGoal.onchange = () => { saveAllData(); updateStatsAndGoal(); syncToCloud(); };
    const textSizeSelect = document.getElementById('textSizeSelect'); if (textSizeSelect) textSizeSelect.onchange = (e) => { settings.textSize = e.target.value; saveSettings(); applySettings(); };
    const darkModeCheck = document.getElementById('darkModeCheckbox'); if (darkModeCheck) darkModeCheck.onchange = (e) => setDarkMode(e.target.checked);
    const alarmSoundCheck = document.getElementById('alarmSoundCheckbox'); if (alarmSoundCheck) alarmSoundCheck.onchange = (e) => setAlarmSound(e.target.checked);
    const concentrationToggle = document.getElementById('concentrationToggle'); if (concentrationToggle) concentrationToggle.onclick = () => setConcentrationMode(!concentrationMode);
    const studyEnd = document.getElementById('studyEndBtn'); if (studyEnd) studyEnd.onclick = manualStudyEnd;

    document.querySelectorAll('.mode-btn').forEach(btn => { btn.onclick = () => switchMode(btn.dataset.mode); });
    document.querySelectorAll('[data-stats-period]').forEach(btn => { /* ... */ });
    const prevBtn = document.getElementById('statsPrevPeriodBtn'); if (prevBtn) prevBtn.onclick = () => { statsPeriodOffset--; updateStatsDailyChart(); };
    const nextBtn = document.getElementById('statsNextPeriodBtn'); if (nextBtn) nextBtn.onclick = () => { statsPeriodOffset++; updateStatsDailyChart(); };

    window.onclick = (e) => {
        if (e.target === document.getElementById('settingsModal')) document.getElementById('settingsModal').style.display = 'none';
        if (e.target === document.getElementById('editPastDataModal')) closeEditModal();
        if (e.target === document.getElementById('manualRecordModal')) document.getElementById('manualRecordModal').style.display = 'none';
        if (e.target === document.getElementById('bookManagementModal')) document.getElementById('bookManagementModal').style.display = 'none';
    };
    switchMode("countdown");
}

window.refreshAllUI = refreshAllUI;
init();
