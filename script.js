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
import { getAuth, signInAnonymously, GoogleAuthProvider, signInWithPopup, linkWithCredential, onAuthStateChanged,
    signOut } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

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
const defaultColors = ['#2a9d8f', '#e9c46a', '#f4a261', '#e76f51', '#6c9ebf', '#9c89b8', '#6d6875', '#4c9aff',
    '#ff6b6b'
];
let bookChartInstances = {};

let timerStartTime = null,
    timerPausedTime = null,
    timerInterval = null,
    isTimerRunning = false;
let timerMode = "countdown",
    targetSeconds = 25 * 60,
    autoLogTriggered = false,
    alarmEnabled = true;
let audioContext = null,
    pomodoroFocusSeconds = 25 * 60,
    pomodoroBreakSeconds = 5 * 60;
let isPomodoroFocus = true,
    pomodoroCycleCount = 0,
    concentrationMode = true;
const studyOverlay = document.getElementById('studyOverlay');
const studyEndBtn = document.getElementById('studyEndBtn');

let statsDailyChart, statsSubjectChart;
let statsDailyChartMobile, statsSubjectChartMobile;
let statsPeriod = "week",
    statsPeriodOffset = 0;
let currentEditBookId = null,
    currentEditDate = null;
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
    const tbodyMobile = document.getElementById('historyTbodyMobile');
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

function renderSubjectTags() {
    const container = document.getElementById('subjectList');
    if (container) container.innerHTML = customSubjects.map(sub => `<span class="subject-tag"><span>${sub}</span><button class="remove-subject" data-subject="${sub}" style="background:none;border:none;cursor:pointer;color:#e76f51;">×</button></span>`).join('');
    document.querySelectorAll('.remove-subject').forEach(btn => { btn.onclick = () => removeSubject(btn.dataset.subject); });
}
function addSubject() {
    const newName = document.getElementById('newSubjectName')?.value.trim();
    if (!newName) { showToast("教科名を入力してください", true); return; }
    if (customSubjects.includes(newName)) { showToast("既に存在する教科です", true); return; }
    customSubjects.push(newName); subjectColorMap.set(newName, defaultColors[subjectColorMap.size % defaultColors.length]); saveAllData(); if (document.getElementById('newSubjectName')) document.getElementById('newSubjectName').value = ''; showToast(`教科「${newName}」を追加しました`); refreshAllUI(); syncToCloud();
}
function removeSubject(subject) {
    if (customSubjects.length <= 1) { showToast("最低1つは教科が必要です", true); return; }
    if (confirm(`教科「${subject}」を削除しますか？`)) {
        sessions = sessions.map(s => s.subject === subject ? { ...s, subject: "その他" } : s);
        customSubjects = customSubjects.filter(s => s !== subject); if (!customSubjects.includes("その他")) customSubjects.push("その他");
        subjectColorMap.delete(subject); saveAllData(); refreshAllUI(); syncToCloud(); showToast(`教科「${subject}」を削除しました`);
    }
}

function saveDiaryToLocal() { localStorage.setItem(STORAGE_KEYS.diary, JSON.stringify(diaryNotes)); }
function saveCurrentDiary() {
    const dateStr = document.getElementById('diaryDate')?.value;
    if (!dateStr) { showToast("日付を選択してください", true); return; }
    if (dateStr !== getTodayLocalStr()) { showToast("過去の日記は編集できません", true); return; }
    const note = document.getElementById('diaryNote')?.value; diaryNotes[dateStr] = note; saveDiaryToLocal(); renderDiaryList(); showToast(`${dateStr} の日記を保存しました`); syncToCloud();
}
function deleteCurrentDiary() {
    const dateStr = document.getElementById('diaryDate')?.value;
    if (!dateStr) return;
    if (dateStr !== getTodayLocalStr()) { showToast("過去の日記は削除できません", true); return; }
    if (diaryNotes[dateStr]) { delete diaryNotes[dateStr]; saveDiaryToLocal(); if (document.getElementById('diaryNote')) document.getElementById('diaryNote').value = ''; renderDiaryList(); showToast(`${dateStr} の日記を削除しました`); syncToCloud(); }
}

function renderDiaryList() {
    const container = document.getElementById('diaryEntriesList');
    const entries = Object.entries(diaryNotes).filter(([_, t]) => t && t.trim()).sort((a, b) => b[0].localeCompare(a[0]));
    if (container) container.innerHTML = entries.length === 0 ? '<div style="text-align:center;color:#94a3b8;padding:16px;">日記がまだありません。</div>' : entries.map(([date, text]) => `<div class="diary-entry" data-date="${date}"><div class="diary-entry-date">${date}</div><div class="diary-entry-text">${escapeHtml(text.substring(0,60))}${text.length>60?'...':''}</div></div>`).join('');
    document.querySelectorAll('.diary-entry').forEach(el => { el.addEventListener('click', () => { const d = el.dataset.date; if (document.getElementById('diaryDate')) document.getElementById('diaryDate').value = d; loadDiaryForDate(d); }); });
}
function loadDiaryForDate(dateStr) {
    const ta = document.getElementById('diaryNote');
    if (ta) {
        ta.value = diaryNotes[dateStr] || ''; const isToday = (dateStr === getTodayLocalStr()); ta.readOnly = !isToday;
        if (document.getElementById('saveDiaryBtn')) document.getElementById('saveDiaryBtn').disabled = !isToday;
        if (document.getElementById('deleteDiaryBtn')) document.getElementById('deleteDiaryBtn').disabled = !isToday;
    }
}

function addBook() {
    const name = document.getElementById('newBookName')?.value.trim(); const total = parseInt(document.getElementById('newBookTotal')?.value);
    if (!name) { showToast("参考書名を入力してください", true); return; }
    if (isNaN(total) || total <= 0) { showToast("総ページ数を正しく入力してください", true); return; }
    books.push({ id: Date.now(), name, totalPages: total, dailyTarget: 0 }); saveBooks(); renderBooks(); if (document.getElementById('newBookName')) document.getElementById('newBookName').value = ''; if (document.getElementById('newBookTotal')) document.getElementById('newBookTotal').value = '200'; showToast(`参考書「${name}」を追加しました`); syncToCloud();
}

function renderCalendarForBook(bookId) {
    const book = books.find(b => b.id === bookId); if (!book) return;
    if (!window.bookDisplayMonths[bookId]) window.bookDisplayMonths[bookId] = { year: new Date().getFullYear(), month: new Date().getMonth() };
    const { year, month } = window.bookDisplayMonths[bookId];
    const days = []; const firstDay = new Date(year, month, 1); const lastDay = new Date(year, month + 1, 0);
    for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) days.push(getLocalDateStr(d));
    const container = document.querySelector(`.calendar-grid[data-calendar="${bookId}"]`);
    const labelSpan = document.querySelector(`.calendar-month-label[data-id="${bookId}"]`);
    if (labelSpan) labelSpan.textContent = `${year}年 ${month+1}月`;
    if (!container) return;
    container.innerHTML = days.map(dateStr => {
        const cumulative = getCumulative(bookId, dateStr); const prevCum = getPreviousCumulative(bookId, dateStr); const todayProgress = cumulative - prevCum; const target = book.dailyTarget || 0; const isAchieved = target > 0 && todayProgress >= target;
        return `<div class="calendar-day ${isAchieved ? 'achieved' : ''}" data-book="${bookId}" data-date="${dateStr}"><span>${dateStr.slice(5)}</span><span>累計:${cumulative}</span></div>`;
    }).join('');
    document.querySelectorAll(`.calendar-day[data-book="${bookId}"]`).forEach(day => { day.addEventListener('click', (e) => { e.stopPropagation(); openEditModal(bookId, day.dataset.date); }); });
}

function openEditModal(bookId, dateStr) { currentEditBookId = bookId; currentEditDate = dateStr; const book = books.find(b => b.id === bookId); if (!book) return; document.getElementById('editModalTitle').innerHTML = `${escapeHtml(book.name)} - ${dateStr} のデータ編集`; document.getElementById('editDate').value = dateStr; document.getElementById('editCumulative').value = getCumulative(bookId, dateStr); document.getElementById('editPastDataModal').style.display = 'flex'; }
function closeEditModal() { document.getElementById('editPastDataModal').style.display = 'none'; currentEditBookId = null; currentEditDate = null; }
function saveEditedData() {
    if (currentEditBookId === null || currentEditDate === null) return;
    const newCumulative = parseInt(document.getElementById('editCumulative').value); if (isNaN(newCumulative) || newCumulative < 0) { showToast("正しい数値を入力してください", true); return; }
    if (!cumulativeProgress[currentEditBookId]) cumulativeProgress[currentEditBookId] = {};
    cumulativeProgress[currentEditBookId][currentEditDate] = newCumulative; saveCumulativeProgress(); closeEditModal(); renderBooks(); syncToCloud(); showToast(`${currentEditDate} の累計ページ数を更新しました`);
}

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
            <div class="book-detail" style="display:none;" data-detail="${book.id}">
                <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px; flex-wrap:wrap;"><span style="font-size:0.7rem;">1日目標:</span><input type="number" class="daily-target-input" data-id="${book.id}" value="${book.dailyTarget || 0}" style="width:60px; padding:5px;"><button class="btn btn-secondary set-target-btn" data-id="${book.id}" style="padding:4px 10px;">設定</button></div>
                <div style="display:flex; gap:8px; align-items:center; margin-bottom:10px; flex-wrap:wrap;"><span style="font-size:0.7rem;">累計:</span><input type="number" class="cumulative-input" data-id="${book.id}" value="${current}" style="width:70px; padding:5px;"><button class="btn btn-primary save-cumulative-btn" data-id="${book.id}" data-date="${today}" style="padding:4px 10px;">保存</button></div>
                <div class="calendar-control"><button class="prev-month-btn" data-id="${book.id}" style="background:#e2e8f0; border:none; width:26px; height:26px; border-radius:26px;">◀</button><span class="calendar-month-label" data-id="${book.id}"></span><button class="next-month-btn" data-id="${book.id}" style="background:#e2e8f0; border:none; width:26px; height:26px; border-radius:26px;">▶</button></div>
                <div class="calendar-grid" data-calendar="${book.id}"></div>
                <div style="margin-top:10px;"><button class="btn btn-secondary delete-book" data-id="${book.id}" style="padding:4px 10px;">削除</button></div>
            </div></div>`;
    }).join('');
    if (container) container.innerHTML = html; if (containerMobile) containerMobile.innerHTML = html;
    // イベント登録は後ほど同じものを使用（省略せずに既存のコードを流用）
    document.querySelectorAll('.book-header').forEach(header => { header.addEventListener('click', () => { const id = parseInt(header.dataset.id); const detail = document.querySelector(`.book-detail[data-detail="${id}"]`); if (detail) { const isVisible = detail.style.display !== 'none'; detail.style.display = isVisible ? 'none' : 'block'; if (!isVisible) renderCalendarForBook(id); } }); });
    document.querySelectorAll('.set-target-btn').forEach(btn => { btn.addEventListener('click', () => { const id = parseInt(btn.dataset.id); const book = books.find(b => b.id === id); if (book) { book.dailyTarget = parseInt(document.querySelector(`.daily-target-input[data-id="${id}"]`).value) || 0; saveBooks(); renderBooks(); showToast(`${book.name} の目標を設定しました`); syncToCloud(); } }); });
    document.querySelectorAll('.save-cumulative-btn').forEach(btn => { btn.addEventListener('click', () => { const id = parseInt(btn.dataset.id); const dateStr = btn.dataset.date; const val = parseInt(document.querySelector(`.cumulative-input[data-id="${id}"]`).value) || 0; if (!cumulativeProgress[id]) cumulativeProgress[id] = {}; cumulativeProgress[id][dateStr] = val; saveCumulativeProgress(); renderBooks(); showToast(`進捗を保存しました`); syncToCloud(); }); });
    document.querySelectorAll('.delete-book').forEach(btn => { btn.addEventListener('click', () => { const id = parseInt(btn.dataset.id); if (confirm(`「${books.find(b=>b.id===id)?.name}」を削除しますか？`)) { books = books.filter(b => b.id !== id); delete cumulativeProgress[id]; saveBooks(); saveCumulativeProgress(); renderBooks(); syncToCloud(); showToast("参考書を削除しました"); } }); });
    document.querySelectorAll('.prev-month-btn').forEach(btn => { btn.addEventListener('click', (e) => { e.stopPropagation(); const id = parseInt(btn.dataset.id); if (!window.bookDisplayMonths[id]) window.bookDisplayMonths[id] = { year: new Date().getFullYear(), month: new Date().getMonth() }; let { year, month } = window.bookDisplayMonths[id]; month--; if (month < 0) { month = 11; year--; } window.bookDisplayMonths[id] = { year, month }; renderCalendarForBook(id); }); });
    document.querySelectorAll('.next-month-btn').forEach(btn => { btn.addEventListener('click', (e) => { e.stopPropagation(); const id = parseInt(btn.dataset.id); if (!window.bookDisplayMonths[id]) window.bookDisplayMonths[id] = { year: new Date().getFullYear(), month: new Date().getMonth() }; let { year, month } = window.bookDisplayMonths[id]; month++; if (month > 11) { month = 0; year++; } window.bookDisplayMonths[id] = { year, month }; renderCalendarForBook(id); }); });
}

function computeStats() { const today = getTodayLocalStr(); let todayTotal = 0, grandTotal = 0; for (let s of sessions) { grandTotal += s.minutes; if (s.dateStr === today) todayTotal += s.minutes; } return { todayTotal, grandTotal }; }

function updateStatsAndGoal() {
    const { todayTotal, grandTotal } = computeStats();
    const ids = { todayTotalMin: ['todayTotalMin', 'todayTotalMinMobile'], totalAllMinutes: ['totalAllMinutes', 'totalAllMinutesMobile'], totalAllMinutes2: ['totalAllMinutes2', 'totalAllMinutes2Mobile'], totalAllTime: ['totalAllTime', 'totalAllTimeMobile'], todayTotalHeader: ['todayTotalHeaderPC', 'todayTotalHeaderMobile'], progressFill: ['progressFill', 'progressFillMobile'], remainTarget: ['remainTarget', 'remainTargetMobile'], weeklyAvgTime: ['weeklyAvgTime', 'weeklyAvgTimeMobile'], weeklyTotal: ['weeklyTotal', 'weeklyTotalMobile'], streakDays: ['streakDays', 'streakDaysMobile'] };
    ids.todayTotalMin.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = todayTotal; });
    ids.totalAllMinutes.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = grandTotal; });
    ids.totalAllMinutes2.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = grandTotal; });
    ids.totalAllTime.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = formatMinutesToHours(grandTotal); });
    ids.todayTotalHeader.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = `今日: ${formatMinutesToHoursShort(todayTotal)}`; });
    const goal = parseInt(document.getElementById('dailyGoalInput')?.value || 120); const percent = goal > 0 ? Math.min(100, (todayTotal / goal) * 100) : 0;
    ids.progressFill.forEach(id => { const el = document.getElementById(id); if (el) el.style.width = `${percent}%`; });
    ids.remainTarget.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = Math.max(0, goal - todayTotal); });
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay() + (weekStart.getDay() === 0 ? -6 : 1)); weekStart.setHours(0,0,0,0); let weeklyTotal = 0, weeklyDays = new Set(); for (let s of sessions) if (parseLocalDate(s.dateStr) >= weekStart) { weeklyTotal += s.minutes; weeklyDays.add(s.dateStr); }
    const weeklyAvg = weeklyDays.size ? Math.round(weeklyTotal / weeklyDays.size) : 0;
    ids.weeklyAvgTime.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = formatMinutesToHoursShort(weeklyAvg); });
    ids.weeklyTotal.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = formatMinutesToHoursShort(weeklyTotal); });
    let streak = 0, checkDate = new Date(); for (let i = 0; i < 365; i++) { if (sessions.some(s => s.dateStr === getLocalDateStr(checkDate))) streak++; else break; checkDate.setDate(checkDate.getDate() - 1); }
    ids.streakDays.forEach(id => { const el = document.getElementById(id); if (el) el.textContent = streak + '日'; });
}

function getPeriodRange(period, offset) { /* 変更なし */ const today = new Date(); if (period === "week") { const refDate = new Date(today); refDate.setDate(today.getDate() + offset * 7); const monday = new Date(refDate); monday.setDate(refDate.getDate() - refDate.getDay() + (refDate.getDay() === 0 ? -6 : 1)); monday.setHours(0,0,0,0); return { startDate: new Date(monday), endDate: new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000) }; } else { const refMonth = new Date(today.getFullYear(), today.getMonth() + offset, 1); return { startDate: new Date(refMonth), endDate: new Date(refMonth.getFullYear(), refMonth.getMonth() + 1, 0) }; } }

function updateStatsDailyChart() { /* 中身は元のまま */ const { startDate, endDate } = getPeriodRange(statsPeriod, statsPeriodOffset); const labels = [], data = []; let cur = new Date(startDate); while (cur <= endDate) { const dateStr = getLocalDateStr(cur); labels.push(statsPeriod === 'month' ? dateStr : dateStr.slice(5)); let total = 0; sessions.forEach(s => { if (s.dateStr === dateStr) total += s.minutes / 60; }); data.push(Math.min(10, total)); cur.setDate(cur.getDate() + 1); } const ctx = document.getElementById('statsDailyChart')?.getContext('2d'); if (ctx) { if (statsDailyChart) statsDailyChart.destroy(); statsDailyChart = new Chart(ctx, { type: 'bar', data: { labels, datasets: [{ label: '勉強時間(時間)', data, backgroundColor: '#2a9d8f' }] }, options: { responsive: true, maintainAspectRatio: true, scales: { y: { max: 10, beginAtZero: true } } } }); const rangeSpan = document.getElementById('statsPeriodRange'); if (rangeSpan) rangeSpan.textContent = `${startDate.toLocaleDateString()} 〜 ${endDate.toLocaleDateString()}`; } const ctxMobile = document.getElementById('statsDailyChartMobile')?.getContext('2d'); if (ctxMobile) { if (statsDailyChartMobile) statsDailyChartMobile.destroy(); statsDailyChartMobile = new Chart(ctxMobile, { type: 'bar', data: { labels, datasets: [{ label: '勉強時間(時間)', data, backgroundColor: '#2a9d8f' }] }, options: { responsive: true, maintainAspectRatio: true, scales: { y: { max: 10, beginAtZero: true } } } }); const rangeSpanMobile = document.getElementById('statsPeriodRangeMobile'); if (rangeSpanMobile) rangeSpanMobile.textContent = `${startDate.toLocaleDateString()} 〜 ${endDate.toLocaleDateString()}`; } }

function updateStatsSubjectChart() { /* 中身は元のまま */ const subjectMap = new Map(); sessions.forEach(s => subjectMap.set(s.subject, (subjectMap.get(s.subject) || 0) + s.minutes / 60)); const ctx = document.getElementById('statsSubjectChart')?.getContext('2d'); if (ctx && subjectMap.size) { if (statsSubjectChart) statsSubjectChart.destroy(); statsSubjectChart = new Chart(ctx, { type: 'pie', data: { labels: Array.from(subjectMap.keys()), datasets: [{ data: Array.from(subjectMap.values()), backgroundColor: Array.from(subjectMap.keys()).map(s => getColorForSubject(s)) }] }, options: { responsive: true, maintainAspectRatio: true } }); const numbersDiv = document.getElementById('subjectStatsNumbers'); if (numbersDiv) numbersDiv.innerHTML = Array.from(subjectMap.entries()).map(([k, v]) => `<div>${k}: ${v.toFixed(1)}時間</div>`).join(''); } const ctxMobile = document.getElementById('statsSubjectChartMobile')?.getContext('2d'); if (ctxMobile && subjectMap.size) { if (statsSubjectChartMobile) statsSubjectChartMobile.destroy(); statsSubjectChartMobile = new Chart(ctxMobile, { type: 'pie', data: { labels: Array.from(subjectMap.keys()), datasets: [{ data: Array.from(subjectMap.values()), backgroundColor: Array.from(subjectMap.keys()).map(s => getColorForSubject(s)) }] }, options: { responsive: true, maintainAspectRatio: true } }); const numbersDivMobile = document.getElementById('subjectStatsNumbersMobile'); if (numbersDivMobile) numbersDivMobile.innerHTML = Array.from(subjectMap.entries()).map(([k, v]) => `<div>${k}: ${v.toFixed(1)}時間</div>`).join(''); } }

function renderBooksProgressGrid() { /* コードは元のまま省略せず含める */ const grid = document.getElementById('booksProgressGrid'); if (!grid || books.length === 0) { if (grid) grid.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;">参考書が登録されていません</div>'; return; } const today = getTodayLocalStr(); const sortedBooks = [...books].sort((a, b) => { const aCompleted = getCumulative(a.id, today) >= a.totalPages; const bCompleted = getCumulative(b.id, today) >= b.totalPages; if (aCompleted !== bCompleted) return aCompleted ? 1 : -1; return a.id - b.id; }); grid.innerHTML = sortedBooks.map(book => { const current = getCumulative(book.id, today); const completed = current >= book.totalPages; return `<div class="book-progress-card ${completed ? 'completed' : ''}" data-book-id="${book.id}"><div class="bp-title">${escapeHtml(book.name)}</div><div class="bp-stats">${current} / ${book.totalPages} ページ</div><canvas id="bookChart-${book.id}" style="width:100%; height:100px;"></canvas></div>`; }).join(''); sortedBooks.forEach(book => { const canvas = document.getElementById(`bookChart-${book.id}`); if (!canvas) return; const ctx = canvas.getContext('2d'); if (bookChartInstances[book.id]) bookChartInstances[book.id].destroy(); const { start, end } = getBookDateRange(book.id); const labels = []; const data = []; const startObj = parseLocalDate(start); const endObj = parseLocalDate(end); for (let d = new Date(startObj); d <= endObj; d.setDate(d.getDate() + 1)) { const ds = getLocalDateStr(d); labels.push(ds.slice(5)); data.push(getCumulative(book.id, ds)); } bookChartInstances[book.id] = new Chart(ctx, { type: 'line', data: { labels, datasets: [{ label: '累計ページ', data, borderColor: '#2a9d8f', backgroundColor: '#2a9d8f20', fill: true, tension: 0.3, pointRadius: 0 }] }, options: { responsive: true, maintainAspectRatio: true, scales: { y: { max: book.totalPages, beginAtZero: true, title: { display: false } }, x: { display: false } }, plugins: { legend: { display: false } } } }); }); }

function refreshAllUI() { renderHistoryTable(); updateStatsAndGoal(); renderDiaryList(); renderBooks(); updateSubjectSelects(); renderSubjectTags(); updateStatsDailyChart(); updateStatsSubjectChart(); renderBooksProgressGrid(); }
function saveAllData() { localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions)); localStorage.setItem(STORAGE_KEYS.subjects, JSON.stringify(customSubjects)); localStorage.setItem(STORAGE_KEYS.diary, JSON.stringify(diaryNotes)); localStorage.setItem(STORAGE_KEYS.books, JSON.stringify(books)); localStorage.setItem(STORAGE_KEYS.progress, JSON.stringify(cumulativeProgress)); localStorage.setItem(STORAGE_KEYS.goal, document.getElementById('dailyGoalInput')?.value || '120'); }
function loadAllData() { /* 中身はそのまま */ const savedSessions = localStorage.getItem(STORAGE_KEYS.sessions); if (savedSessions) { try { sessions = JSON.parse(savedSessions); } catch (e) {} } const savedSubjects = localStorage.getItem(STORAGE_KEYS.subjects); if (savedSubjects) { try { const loaded = JSON.parse(savedSubjects); if (loaded.length) customSubjects = loaded; } catch (e) {} } const savedDiary = localStorage.getItem(STORAGE_KEYS.diary); if (savedDiary) { try { diaryNotes = JSON.parse(savedDiary); } catch (e) {} } const savedBooks = localStorage.getItem(STORAGE_KEYS.books); if (savedBooks) { try { books = JSON.parse(savedBooks); } catch (e) {} } const savedProgress = localStorage.getItem(STORAGE_KEYS.progress); if (savedProgress) { try { cumulativeProgress = JSON.parse(savedProgress); } catch (e) {} } const savedGoal = localStorage.getItem(STORAGE_KEYS.goal); if (savedGoal && document.getElementById('dailyGoalInput')) document.getElementById('dailyGoalInput').value = savedGoal; if (!savedSessions) { const today = getTodayLocalStr(); sessions = [{ id: Date.now() + 1, dateStr: today, startTime: "10:30", subject: "数学", minutes: 60 }, { id: Date.now() + 2, dateStr: today, startTime: "14:15", subject: "英語", minutes: 45 }]; saveAllData(); } subjectColorMap.clear(); customSubjects.forEach((sub, idx) => subjectColorMap.set(sub, defaultColors[idx % defaultColors.length])); }

/* タイマー関連の関数はそのまま（getRemainingSeconds, updateTimerDisplay, etc.） */
let timerIntervalId = null;
function getRemainingSeconds() { if (!isTimerRunning) return (timerMode === "countdown" || timerMode === "pomodoro") ? (timerPausedTime ?? targetSeconds) : (timerPausedTime ?? 0); const elapsed = (Date.now() - timerStartTime) / 1000; return (timerMode === "countdown" || timerMode === "pomodoro") ? Math.max(0, targetSeconds - elapsed) : elapsed; }
function updateTimerDisplay() { const sec = Math.floor(getRemainingSeconds()); const mins = Math.floor(sec / 60); const remainingSecs = sec % 60; const displayText = `${mins.toString().padStart(2,'0')}:${remainingSecs.toString().padStart(2,'0')}`; const timerDisplay = document.getElementById('timerDisplay'); if (timerDisplay) timerDisplay.textContent = displayText; const timerDisplayMobile = document.getElementById('timerDisplayMobile'); if (timerDisplayMobile) timerDisplayMobile.textContent = displayText; const studyTimer = document.getElementById('studyTimerDisplay'); if (studyOverlay && !studyOverlay.classList.contains('hidden') && studyTimer) studyTimer.textContent = displayText; }
function playShortAlarm() { if (!alarmEnabled) return; try { if (!audioContext) audioContext = new AudioContext(); const osc = audioContext.createOscillator(); const gain = audioContext.createGain(); osc.connect(gain); gain.connect(audioContext.destination); osc.frequency.value = 880; gain.gain.value = 0.3; osc.start(); gain.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + 0.3); osc.stop(audioContext.currentTime + 0.3); } catch (e) {} }
function startTimer() { /* 中身は元のまま */ if (isTimerRunning) return; const cur = getRemainingSeconds(); if ((timerMode === "countdown" || timerMode === "pomodoro") && cur <= 0) { showToast("時間を設定してください", true); return; } timerStartTime = Date.now(); if (timerMode === "countdown" || timerMode === "pomodoro") targetSeconds = cur; timerPausedTime = null; isTimerRunning = true; autoLogTriggered = false; if (concentrationMode && timerMode !== "pomodoro") studyOverlay.classList.remove('hidden'); if (timerIntervalId) clearInterval(timerIntervalId); timerIntervalId = setInterval(() => { updateTimerDisplay(); const rem = getRemainingSeconds(); if ((timerMode === "countdown" || timerMode === "pomodoro") && rem <= 0 && !autoLogTriggered) { autoLogTriggered = true; pauseTimer(); if (timerMode === "pomodoro") { if (isPomodoroFocus) { const subject = document.getElementById('timerSubjectSelect')?.value; addStudyRecord(subject, pomodoroFocusSeconds / 60, getTodayLocalStr(), new Date().toLocaleTimeString()); playShortAlarm(); isPomodoroFocus = false; targetSeconds = pomodoroBreakSeconds; timerPausedTime = targetSeconds; const pomodoroStatus = document.getElementById('pomodoroStatus'); if (pomodoroStatus) pomodoroStatus.innerHTML = '休憩タイム'; const sessionStatus = document.getElementById('sessionStatusText'); if (sessionStatus) sessionStatus.innerHTML = '休憩中'; startTimer(); } else { pomodoroCycleCount++; isPomodoroFocus = true; targetSeconds = pomodoroFocusSeconds; timerPausedTime = targetSeconds; const pomodoroStatus = document.getElementById('pomodoroStatus'); if (pomodoroStatus) pomodoroStatus.innerHTML = '集中タイム'; const sessionStatus = document.getElementById('sessionStatusText'); if (sessionStatus) sessionStatus.innerHTML = '集中タイム'; startTimer(); } } else { const subject = document.getElementById('timerSubjectSelect')?.value; addStudyRecord(subject, targetSeconds / 60, getTodayLocalStr(), new Date().toLocaleTimeString()); playShortAlarm(); resetTimer(); const sessionStatus = document.getElementById('sessionStatusText'); if (sessionStatus) sessionStatus.innerHTML = '勉強完了'; } studyOverlay.classList.add('hidden'); } }, 100); }
function pauseTimer() { if (!isTimerRunning) return; timerPausedTime = getRemainingSeconds(); if (timerMode === "countdown" || timerMode === "pomodoro") targetSeconds = timerPausedTime; isTimerRunning = false; if (timerIntervalId) { clearInterval(timerIntervalId); timerIntervalId = null; } studyOverlay.classList.add('hidden'); }
function resetTimer() { pauseTimer(); if (timerMode === "countdown") { targetSeconds = 25 * 60; timerPausedTime = targetSeconds; const sessionStatus = document.getElementById('sessionStatusText'); if (sessionStatus) sessionStatus.innerHTML = 'カウントダウン待機'; } else if (timerMode === "pomodoro") { isPomodoroFocus = true; pomodoroCycleCount = 0; targetSeconds = pomodoroFocusSeconds; timerPausedTime = targetSeconds; const pomodoroStatus = document.getElementById('pomodoroStatus'); if (pomodoroStatus) pomodoroStatus.innerHTML = '集中タイム'; const sessionStatus = document.getElementById('sessionStatusText'); if (sessionStatus) sessionStatus.innerHTML = 'ポモドーロ準備完了'; } else { timerPausedTime = 0; targetSeconds = 0; const sessionStatus = document.getElementById('sessionStatusText'); if (sessionStatus) sessionStatus.innerHTML = 'ストップウォッチ待機'; } updateTimerDisplay(); autoLogTriggered = false; studyOverlay.classList.add('hidden'); }
function manualStudyEnd() { if (!isTimerRunning) return; const elapsed = (timerMode === "countdown" || timerMode === "pomodoro") ? targetSeconds - getRemainingSeconds() : getRemainingSeconds(); if (elapsed <= 0) { showToast("勉強時間が0分です", true); return; } const subject = document.getElementById('timerSubjectSelect')?.value; addStudyRecord(subject, elapsed / 60, getTodayLocalStr(), new Date().toLocaleTimeString()); resetTimer(); showToast("記録しました"); }
function setCountdownTarget(minutes) { if (timerMode === "countdown") { targetSeconds = minutes * 60; timerPausedTime = targetSeconds; updateTimerDisplay(); const sessionStatus = document.getElementById('sessionStatusText'); if (sessionStatus) sessionStatus.innerHTML = `${minutes}分に設定`; } }
function setPomodoroTimes(focus, brk) { pomodoroFocusSeconds = focus * 60; pomodoroBreakSeconds = brk * 60; if (timerMode === "pomodoro") { isPomodoroFocus = true; pomodoroCycleCount = 0; targetSeconds = pomodoroFocusSeconds; timerPausedTime = targetSeconds; updateTimerDisplay(); const pomodoroStatus = document.getElementById('pomodoroStatus'); if (pomodoroStatus) pomodoroStatus.innerHTML = '集中タイム'; const sessionStatus = document.getElementById('sessionStatusText'); if (sessionStatus) sessionStatus.innerHTML = 'ポモドーロ準備完了'; } }

function switchMode(mode) {
    pauseTimer(); timerMode = mode;
    const normalSettings = document.getElementById('normalTimerSettings'); const pomodoroSettings = document.getElementById('pomodoroSettings');
    if (normalSettings) normalSettings.style.display = mode === "pomodoro" ? 'none' : 'block';
    if (pomodoroSettings) pomodoroSettings.style.display = mode === "pomodoro" ? 'block' : 'none';
    if (mode === "countdown") { if (targetSeconds === 0) targetSeconds = 25 * 60; timerPausedTime = targetSeconds; const sessionStatus = document.getElementById('sessionStatusText'); if (sessionStatus) sessionStatus.innerHTML = 'カウントダウン待機'; }
    else if (mode === "stopwatch") { timerPausedTime = 0; targetSeconds = 0; const sessionStatus = document.getElementById('sessionStatusText'); if (sessionStatus) sessionStatus.innerHTML = 'ストップウォッチ待機'; }
    else { isPomodoroFocus = true; pomodoroCycleCount = 0; targetSeconds = pomodoroFocusSeconds; timerPausedTime = targetSeconds; const sessionStatus = document.getElementById('sessionStatusText'); if (sessionStatus) sessionStatus.innerHTML = 'ポモドーロ準備完了'; }
    updateTimerDisplay();
    document.querySelectorAll('.mode-btn').forEach(btn => { if (btn.dataset.mode === mode) btn.classList.add('active'); else btn.classList.remove('active'); });
}

function logCurrentTimer() { if (timerMode === "pomodoro") { showToast("ポモドーロは自動記録されます", true); return; } const elapsed = timerMode === "countdown" ? targetSeconds - getRemainingSeconds() : getRemainingSeconds(); if (elapsed <= 0) { showToast("タイマーをスタートしてください", true); return; } const subject = document.getElementById('timerSubjectSelect')?.value; addStudyRecord(subject, Math.max(1, Math.round(elapsed / 60)), getTodayLocalStr(), new Date().toLocaleTimeString()); resetTimer(); showToast("記録しました"); }
function handleManualAdd() { const mins = parseInt(document.getElementById('manualMinutes')?.value); if (isNaN(mins) || mins <= 0) { alert("1分以上を入力してください"); return; } const subject = document.getElementById('manualSubject')?.value; const date = document.getElementById('manualDate')?.value; const startTime = document.getElementById('manualStartTime')?.value; addStudyRecord(subject, mins, date, startTime); if (document.getElementById('manualMinutes')) document.getElementById('manualMinutes').value = "30"; }

let settings = { textSize: '21px', darkMode: false, alarmSound: true, concentrationMode: true };
function loadSettings() { const stored = localStorage.getItem('app_settings'); if (stored) { try { settings = JSON.parse(stored); } catch (e) {} } applySettings(); }
function saveSettings() { localStorage.setItem('app_settings', JSON.stringify(settings)); }
function applySettings() { const html = document.documentElement; html.classList.remove('text-10px', 'text-12px', 'text-14px', 'text-16px', 'text-18px', 'text-21px', 'text-24px', 'text-28px', 'text-32px', 'text-40px'); html.classList.add(`text-${settings.textSize}`); const sizeSelect = document.getElementById('textSizeSelect'); if (sizeSelect) sizeSelect.value = settings.textSize; if (settings.darkMode) document.body.classList.add('dark-mode'); else document.body.classList.remove('dark-mode'); const darkCheck = document.getElementById('darkModeCheckbox'); if (darkCheck) darkCheck.checked = settings.darkMode; const darkToggle = document.getElementById('darkModeToggle'); if (darkToggle) darkToggle.textContent = settings.darkMode ? '☀️' : '🌙'; alarmEnabled = settings.alarmSound; const alarmCheck = document.getElementById('alarmSoundCheckbox'); if (alarmCheck) alarmCheck.checked = settings.alarmSound; concentrationMode = settings.concentrationMode; const concToggle = document.getElementById('concentrationToggle'); if (concToggle) concToggle.classList.toggle('active', concentrationMode); }
function setDarkMode(enabled) { settings.darkMode = enabled; saveSettings(); applySettings(); }
function setAlarmSound(enabled) { settings.alarmSound = enabled; saveSettings(); applySettings(); }
function setConcentrationMode(enabled) { settings.concentrationMode = enabled; concentrationMode = enabled; saveSettings(); applySettings(); if (!enabled) studyOverlay.classList.add('hidden'); }

function exportData() { const data = { sessions, customSubjects, diaryNotes, books, cumulativeProgress, goal: document.getElementById('dailyGoalInput')?.value }; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' })); a.download = `studytrack_backup_${new Date().toISOString().slice(0,19)}.json`; a.click(); showToast("データを書き出しました"); }
function importData(file) { const reader = new FileReader(); reader.onload = (e) => { try { const data = JSON.parse(e.target.result); if (data.sessions) sessions = data.sessions; if (data.customSubjects) customSubjects = data.customSubjects; if (data.diaryNotes) diaryNotes = data.diaryNotes; if (data.books) books = data.books; if (data.cumulativeProgress) cumulativeProgress = data.cumulativeProgress; if (data.goal && document.getElementById('dailyGoalInput')) document.getElementById('dailyGoalInput').value = data.goal; saveAllData(); refreshAllUI(); syncToCloud(); showToast("データを読み込みました"); } catch (err) { alert("ファイルの読み込みに失敗しました"); } }; reader.readAsText(file); }
function clearAllData() { if (confirm("全てのデータを削除しますか？")) { sessions = []; customSubjects = ["数学", "英語", "理科", "社会", "国語", "プログラミング", "その他"]; diaryNotes = {}; books = []; cumulativeProgress = {}; localStorage.clear(); loadAllData(); refreshAllUI(); syncToCloud(); showToast("全てのデータを削除しました"); } }
function resetSettings() { settings = { textSize: '21px', darkMode: false, alarmSound: true, concentrationMode: true }; concentrationMode = true; saveSettings(); applySettings(); showToast("設定をリセットしました"); }

async function syncToCloud() { if (!currentUser) { showToast("認証待機中...", true); return; } try { isLocalUpdating = true; await setDoc(doc(db, 'studyData', currentUser.uid), { sessions, customSubjects, diaryNotes, books, cumulativeProgress, dailyGoal: document.getElementById('dailyGoalInput')?.value, lastSync: new Date().toISOString() }); showToast('クラウドに同期しました'); } catch (e) { console.error(e); showToast('同期失敗: ' + e.message, true); } finally { isLocalUpdating = false; } }
async function syncFromCloud() { if (!currentUser) { showToast("認証待機中...", true); return; } try { const docSnap = await getDoc(doc(db, 'studyData', currentUser.uid)); if (docSnap.exists()) { const data = docSnap.data(); sessions = data.sessions || []; customSubjects = data.customSubjects || ["数学", "英語", "理科", "社会", "国語", "プログラミング", "その他"]; diaryNotes = data.diaryNotes || {}; books = data.books || []; cumulativeProgress = data.cumulativeProgress || {}; if (data.dailyGoal && document.getElementById('dailyGoalInput')) document.getElementById('dailyGoalInput').value = data.dailyGoal; saveAllData(); refreshAllUI(); showToast('クラウドから復元しました'); } else showToast('クラウドにデータがありません', true); } catch (e) { console.error(e); showToast('復元失敗: ' + e.message, true); } }
function startRealtimeSync() { if (unsubscribe) unsubscribe(); if (!currentUser) return; unsubscribe = onSnapshot(doc(db, 'studyData', currentUser.uid), (docSnap) => { if (docSnap.exists() && !isLocalUpdating && docSnap.data().lastSync > (localStorage.getItem('lastSync') || '')) { showToast('他のデバイスからの更新を検出しました'); syncFromCloud(); } }); }

function updateUserUI() { if (currentUser && !currentUser.isAnonymous) { const userName = currentUser.email ? currentUser.email.split('@')[0] : 'Google'; const userInfo = document.getElementById('userInfoAreaPC'); if (userInfo) { userInfo.style.display = 'flex'; userInfo.innerHTML = `<span>${userName}</span><button id="logoutBtn" style="background:none;border:none;cursor:pointer;">×</button>`; document.getElementById('logoutBtn')?.addEventListener('click', () => { signOut(auth); location.reload(); }); } const googleBtn = document.getElementById('googleLoginBtnPC'); if (googleBtn) googleBtn.style.display = 'none'; } else { const userInfo = document.getElementById('userInfoAreaPC'); if (userInfo) userInfo.style.display = 'none'; const googleBtn = document.getElementById('googleLoginBtnPC'); if (googleBtn) googleBtn.style.display = 'block'; } }
async function upgradeToGoogle() { if (!currentUser) { showToast('認証待機中です...', true); return; } if (!currentUser.isAnonymous) { showToast('既に認証済みです'); return; } showToast('Googleアカウントを選択してください...'); try { const result = await signInWithPopup(auth, provider); const credential = GoogleAuthProvider.credentialFromResult(result); await linkWithCredential(currentUser, credential); await syncToCloud(); showToast('同期に成功しました。ページをリロードします'); setTimeout(() => location.reload(), 1500); } catch (error) { console.error(error); alert('同期に失敗しました: ' + error.message); } }
async function loadOrMigrateData() { if (!currentUser) return; const docSnap = await getDoc(doc(db, 'studyData', currentUser.uid)); if (docSnap.exists()) { const data = docSnap.data(); if (data.lastSync > (localStorage.getItem('lastSync') || '')) { sessions = data.sessions || []; customSubjects = data.customSubjects || ["数学", "英語", "理科", "社会", "国語", "プログラミング", "その他"]; diaryNotes = data.diaryNotes || {}; books = data.books || []; cumulativeProgress = data.cumulativeProgress || {}; if (data.dailyGoal && document.getElementById('dailyGoalInput')) document.getElementById('dailyGoalInput').value = data.dailyGoal; saveAllData(); refreshAllUI(); showToast('クラウドデータを復元しました'); } } else if (localStorage.getItem(STORAGE_KEYS.sessions)) await syncToCloud(); refreshAllUI(); }

function getBookDateRange(bookId) { const prog = cumulativeProgress[bookId] || {}; const dates = Object.keys(prog).sort(); if (dates.length === 0) { return { start: getTodayLocalStr(), end: getTodayLocalStr() }; } const startDate = dates[0]; const book = books.find(b => b.id === bookId); if (!book) return { start: startDate, end: getTodayLocalStr() }; let endDate = getTodayLocalStr(); let cumulative = 0; for (let date of dates) { cumulative = prog[date]; if (cumulative >= book.totalPages) { endDate = date; break; } } return { start: startDate, end: endDate }; }

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

// ★ サイドバーセクション開閉の追加処理
function initSidebarSections() {
    const sectionItems = document.querySelectorAll('.sidebar-nav-item[data-sidebar-section]');
    const sections = document.querySelectorAll('.sidebar-section-content');

    sectionItems.forEach(item => {
        item.addEventListener('click', () => {
            const sectionId = item.dataset.sidebarSection;
            const section = document.getElementById(sectionId);
            if (!section) return;

            const isVisible = section.style.display !== 'none';
            if (isVisible) {
                section.style.display = 'none';
                item.classList.remove('active');
            } else {
                // 他のセクションを全て閉じる（任意）
                sections.forEach(s => s.style.display = 'none');
                sectionItems.forEach(i => i.classList.remove('active'));
                section.style.display = 'block';
                item.classList.add('active');
            }
        });
    });
}

function updateDateTime() {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
    const startTime = document.getElementById('manualStartTime');
    if (startTime && !startTime._userChanged) startTime.value = timeStr;
    const todayStr = getTodayLocalStr();
    const manualDate = document.getElementById('manualDate');
    if (manualDate && !manualDate._userChanged) manualDate.value = todayStr;
}

onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
        updateUserUI();
        startRealtimeSync();
        await loadOrMigrateData();
    } else signInAnonymously(auth);
});

function init() {
    loadSettings();
    loadAllData();
    refreshAllUI();
    const todayStr = getTodayLocalStr();
    const diaryDate = document.getElementById('diaryDate');
    if (diaryDate) diaryDate.value = todayStr;
    loadDiaryForDate(todayStr);
    updateDateTime();
    setInterval(updateDateTime, 1000);
    initPCTabs();
    initMobileTabs();
    initSidebarSections();  // ★ 追加

    const btnIds = ['startTimerBtn', 'pauseTimerBtn', 'resetTimerBtn', 'logTimerBtn', 'addManualRecordBtn',
        'clearAllHistoryBtn', 'setCustomTimeBtn', 'setPomodoroTimeBtn', 'addSubjectBtn', 'saveDiaryBtn',
        'deleteDiaryBtn', 'addBookBtn', 'darkModeToggle', 'hamburgerBtn', 'closeSettingsBtn',
        'resetSettingsBtn', 'clearAllDataBtn', 'exportDataBtn', 'importDataBtn', 'syncToCloudBtn',
        'syncFromCloudBtn', 'googleLoginBtnPC', 'saveEditBtn', 'cancelEditBtn'
    ];
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
        }
    });

    const fileInput = document.getElementById('fileInput');
    if (fileInput) fileInput.onchange = (e) => { if (e.target.files.length) importData(e.target.files[0]); e.target.value = ''; };
    const dailyGoal = document.getElementById('dailyGoalInput');
    if (dailyGoal) dailyGoal.onchange = () => { saveAllData(); updateStatsAndGoal(); syncToCloud(); };
    const textSizeSelect = document.getElementById('textSizeSelect');
    if (textSizeSelect) textSizeSelect.onchange = (e) => { settings.textSize = e.target.value; saveSettings(); applySettings(); };
    const darkModeCheck = document.getElementById('darkModeCheckbox');
    if (darkModeCheck) darkModeCheck.onchange = (e) => setDarkMode(e.target.checked);
    const alarmSoundCheck = document.getElementById('alarmSoundCheckbox');
    if (alarmSoundCheck) alarmSoundCheck.onchange = (e) => setAlarmSound(e.target.checked);
    const concentrationToggle = document.getElementById('concentrationToggle');
    if (concentrationToggle) concentrationToggle.onclick = () => setConcentrationMode(!concentrationMode);
    const studyEnd = document.getElementById('studyEndBtn');
    if (studyEnd) studyEnd.onclick = manualStudyEnd;

    document.querySelectorAll('.mode-btn').forEach(btn => { btn.onclick = () => switchMode(btn.dataset.mode); });
    document.querySelectorAll('[data-stats-period]').forEach(btn => {
        btn.onclick = () => { document.querySelectorAll('[data-stats-period]').forEach(b => b.classList.remove('active')); btn.classList.add('active'); statsPeriod = btn.dataset.statsPeriod; statsPeriodOffset = 0; updateStatsDailyChart(); };
    });
    const prevBtn = document.getElementById('statsPrevPeriodBtn');
    if (prevBtn) prevBtn.onclick = () => { statsPeriodOffset--; updateStatsDailyChart(); };
    const nextBtn = document.getElementById('statsNextPeriodBtn');
    if (nextBtn) nextBtn.onclick = () => { statsPeriodOffset++; updateStatsDailyChart(); };

    window.onclick = (e) => {
        if (e.target === document.getElementById('settingsModal')) document.getElementById('settingsModal').style.display = 'none';
        if (e.target === document.getElementById('editPastDataModal')) closeEditModal();
    };
    switchMode("countdown");
}

window.refreshAllUI = refreshAllUI;
init();
