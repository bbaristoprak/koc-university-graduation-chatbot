// ══════════════════════════════════════════════════════════════════════════════
// app.js — Application initialization and event listeners
// ══════════════════════════════════════════════════════════════════════════════

let currentLang = 'tr';

function toggleLanguage() {
  currentLang = currentLang === 'tr' ? 'en' : 'tr';
  renderStudentList();
  if (selectedStudent) selectStudent(selectedStudent.student_id);
  
  // Update toggle button text if exists
  const btn = document.getElementById('lang-toggle');
  if (btn) btn.textContent = currentLang.toUpperCase();
  
  // Update static UI texts
  const brand = document.getElementById('brand-title');
  if (brand) brand.textContent = currentLang === 'tr' ? 'Mezuniyet Asistanı' : 'Graduation Advisor';
  
  const sidebarHeader = document.getElementById('sidebar-header');
  if (sidebarHeader) sidebarHeader.textContent = currentLang === 'tr' ? 'Öğrenci Seç' : 'Select Student';

  const emptyHint = document.getElementById('empty-hint');
  if (emptyHint) emptyHint.textContent = currentLang === 'tr' ? '← Soldan bir öğrenci seçin' : '← Select a student from the left';

  const defaultEmpty = document.getElementById('empty-state');
  if (defaultEmpty) {
    defaultEmpty.innerHTML = currentLang === 'tr' 
      ? '<div class="empty-icon">🎓</div><div class="empty-title">Mezuniyet Asistanı</div><div class="empty-sub">Soldaki listeden bir öğrenci seçin, ardından mezuniyet durumu hakkında soru sorun.</div>'
      : '<div class="empty-icon">🎓</div><div class="empty-title">Graduation Advisor</div><div class="empty-sub">Select a student from the left list, then ask a question about their graduation status.</div>';
  }

  const hint = document.getElementById('input-hint');
  if (!selectedStudent && hint) {
    hint.textContent = currentLang === 'tr' ? 'Önce soldan bir öğrenci seçin' : 'Select a student from the left first';
  }
}


// ── INPUT HANDLING ──
function handleSend() {
  const box = document.getElementById('input-box');
  const val = box.value.trim();
  if (!val || isLoading) return;
  box.value = '';
  box.style.height = 'auto';
  chat(val);
}

function sendQuick(text) {
  document.getElementById('input-box').value = text;
  handleSend();
}

// ── INITIALIZATION ──
document.addEventListener('DOMContentLoaded', async () => {
  // Load student data from server first
  await loadStudentsData();
  renderStudentList();
  document.getElementById('model-tag').textContent = MODEL;
  checkMemoryProxy();
  // Check proxy status every 30s
  setInterval(checkMemoryProxy, 30000);

  const box = document.getElementById('input-box');
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });
  box.addEventListener('input', () => {
    box.style.height = 'auto';
    box.style.height = Math.min(box.scrollHeight, 120) + 'px';
  });
});
