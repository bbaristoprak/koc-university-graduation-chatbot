// ══════════════════════════════════════════════════════════════════════════════
// ui.js — DOM rendering functions (student list, message bubbles)
// ══════════════════════════════════════════════════════════════════════════════

const i18n = {
  tr: {
    creditProgress: "Kredi İlerleme",
    creditsLeft: "Kalan Kredi",
    creditsEnrolledNote: "({num} aktif)",
    coursesLeft: "Kalan Ders",
    coursesActiveNote: "({num} aktif)",
    enrolledCourses: "Aktif Alınan Ders / Max Load",
    estGraduation: "Tahmini Mezuniyet",
    minSem: "min. {num} dönem",
    endOfSem: "Bu dönem sonu",
    courses: "ders",
    semester: "{num}. dönem",
    welcomeMem: "Merhaba! <strong>{name}</strong> — seni hatırlıyorum, {num} önceki sohbetimiz var.\n\nAşağıdaki hızlı sorulardan birini seçebilir ya da kendi sorunuzu yazabilirsiniz.",
    welcomeNew: "Merhaba! <strong>{name}</strong> hakkında {uni} {program} mezuniyet bilgilerine erişimim var.\n\nAşağıdaki hızlı sorulardan birini seçebilir ya da kendi sorunuzu yazabilirsiniz.",
    inputHint: "Enter ile gönder · Shift+Enter yeni satır",
    qp1: "Ne zaman mezun olabilirim?",
    qp2: "Kalan zorunlu derslerim neler?",
    qp3: "Kaç kredim kaldı?",
    qp4: "Max yük ne kadar?"
  },
  en: {
    creditProgress: "Credit progress",
    creditsLeft: "Credits Left",
    creditsEnrolledNote: "({num} enrolled)",
    coursesLeft: "Future Courses",
    coursesActiveNote: "({num} active)",
    enrolledCourses: "Enrolled / Max",
    estGraduation: "Est. Graduation",
    minSem: "min. {num} sem.",
    endOfSem: "End of semester",
    courses: "courses",
    semester: "Semester {num}",
    welcomeMem: "Hi! <strong>{name}</strong> — I remember you, we've had {num} previous conversations.\n\nYou can pick one of the quick questions below or type your own.",
    welcomeNew: "Hi! I have access to <strong>{name}</strong>'s graduation info for {program} at {uni}.\n\nPick a quick question below or type your own.",
    inputHint: "Enter to send · Shift+Enter for new line",
    qp1: "When can I graduate?",
    qp2: "Required courses left?",
    qp3: "Credits left?",
    qp4: "Max course load?"
  }
};

// ── STUDENT LIST ──

function renderStudentList() {
  const list = document.getElementById('student-list');
  list.innerHTML = '';
  STUDENTS_DATA.students.forEach(s => {
    const cs = computeCreditSummary(s);
    const pct = Math.round((cs.totalCompleted / cs.totalRequired) * 100);
    const barClass = s.gpa < 2.0 ? 'amber' : (pct > 70 ? 'green' : '');
    const card = document.createElement('div');
    card.className = 'student-card';
    card.dataset.id = s.student_id;
    card.innerHTML = `
      <div class="sc-name">${s.name}</div>
      <div class="sc-meta">
        <span class="sc-id">${s.student_id}</span>
        <span class="sc-id">GPA ${s.gpa}</span>
      </div>
      <div class="sc-progress-wrap">
        <div class="sc-progress-label">
          <span>${i18n[currentLang].creditProgress}</span>
          <span>${cs.totalCompleted}/${cs.totalRequired}</span>
        </div>
        <div class="sc-bar"><div class="sc-bar-fill ${barClass}" style="width:${pct}%"></div></div>
      </div>
    `;
    card.addEventListener('click', () => selectStudent(s.student_id));
    list.appendChild(card);
  });
}

// ── STUDENT SELECTION ──
async function selectStudent(id) {
  selectedStudent = STUDENTS_DATA.students.find(s => s.student_id === id);
  conversationHistory = [];
  currentMemories = [];

  // sidebar active state
  document.querySelectorAll('.student-card').forEach(c => {
    c.classList.toggle('active', c.dataset.id === id);
  });

  // strip
  const strip = document.getElementById('student-strip');
  const est = calculateGraduation(selectedStudent);
  const cs = computeCreditSummary(selectedStudent);
  
  const text = i18n[currentLang];
  const semText = text.semester.replace('{num}', selectedStudent.current_semester);
  const estSemText = est.min_semesters_remaining === 0 ? text.endOfSem : text.minSem.replace('{num}', est.min_semesters_remaining);
  
  strip.innerHTML = `
    <div>
      <div class="strip-name">${selectedStudent.name}</div>
      <div style="font-size:11px;color:var(--text3);margin-top:2px">${selectedStudent.student_id} · ${STUDENTS_DATA.meta.program} · ${semText}</div>
    </div>
    <div class="strip-stats">
      <div class="strip-stat">
        <div class="strip-stat-label">${text.enrolledCourses}</div>
        <div class="strip-stat-val accent" style="color:var(--blue)">${cs.currentCoursesCount} / ${selectedStudent.max_courses_per_semester}</div>
      </div>
      <div class="strip-stat">
        <div class="strip-stat-label">${text.creditsLeft}</div>
        <div class="strip-stat-val accent">${cs.totalRemainingCredits} <span style="font-size:10px;color:var(--text3);font-weight:400">${cs.currentEnrolledCredits > 0 ? text.creditsEnrolledNote.replace('{num}', cs.currentEnrolledCredits) : ''}</span></div>
      </div>
      <div class="strip-stat">
        <div class="strip-stat-label">${text.coursesLeft}</div>
        <div class="strip-stat-val accent">${cs.totalRemainingCourses} <span style="font-size:10px;color:var(--text3);font-weight:400">${cs.currentCoursesCount > 0 ? text.coursesActiveNote.replace('{num}', cs.currentCoursesCount) : ''}</span></div>
      </div>
      <div class="strip-stat">
        <div class="strip-stat-label">${text.estGraduation}</div>
        <div class="strip-stat-val">${estSemText}</div>
      </div>
    </div>
  `;

  // update quick prompts
  document.getElementById('quick-prompts').innerHTML = `
    <button class="qp-btn" onclick="sendQuick('${text.qp1}')">${text.qp1}</button>
    <button class="qp-btn" onclick="sendQuick('${text.qp2}')">${text.qp2}</button>
    <button class="qp-btn" onclick="sendQuick('${text.qp3}')">${text.qp3}</button>
    <button class="qp-btn" onclick="sendQuick('${text.qp4}')">${text.qp4}</button>
  `;

  // messages
  const msgs = document.getElementById('messages');
  msgs.innerHTML = '';

  // load memory
  loadMemory(selectedStudent.student_id).then(memories => {
    currentMemories = memories;
    if (memories.length > 0) {
      appendMessage('assistant', text.welcomeMem.replace('{name}', selectedStudent.name).replace('{num}', memories.length));
    }
  });

  // welcome message
  const welcomeStr = text.welcomeNew.replace('{name}', selectedStudent.name).replace('{uni}', STUDENTS_DATA.meta.university).replace('{program}', STUDENTS_DATA.meta.program);
  appendMessage('assistant', welcomeStr);

  // enable input
  document.getElementById('input-box').disabled = false;
  document.getElementById('send-btn').disabled = false;
  document.getElementById('input-hint').textContent = text.inputHint;
  document.getElementById('quick-prompts').style.display = 'flex';
}

// ── MESSAGES ──
function renderMarkdown(text) {
  if (typeof marked === 'undefined') return text.replace(/\n/g, '<br>');
  return marked.parse(text, { breaks: true, gfm: true });
}

function appendMessage(role, text) {
  const msgs = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  const avatarText = role === 'assistant' ? 'AI' : (selectedStudent?.name?.split(' ').map(w=>w[0]).join('').slice(0,2) || 'SZ');
  div.innerHTML = `
    <div class="msg-avatar">${avatarText}</div>
    <div class="msg-body">${renderMarkdown(text)}</div>
  `;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

// For streaming: create empty bubble, then fill it
function appendStreamingMessage() {
  const msgs = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'msg assistant';
  div.innerHTML = `<div class="msg-avatar">AI</div><div class="msg-body streaming-body"></div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div.querySelector('.streaming-body');
}

function appendTyping() {
  const msgs = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'msg assistant typing-indicator';
  div.id = 'typing';
  div.innerHTML = `
    <div class="msg-avatar">AI</div>
    <div class="msg-body">
      <div class="dot-flashing"></div>
      <div class="dot-flashing"></div>
      <div class="dot-flashing"></div>
    </div>
  `;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function removeTyping() {
  const t = document.getElementById('typing');
  if (t) t.remove();
}
