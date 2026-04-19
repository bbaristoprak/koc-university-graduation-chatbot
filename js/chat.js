// ══════════════════════════════════════════════════════════════════════════════
// chat.js — Ana sohbet mantığı, Ollama API çağrıları ve streaming
// ══════════════════════════════════════════════════════════════════════════════

const PROXY_URL = 'http://localhost:5050';
const MODEL = 'llama3.1:8b'; // works in local Ollama, no API key needed

// ── STATE ──
let selectedStudent = null;
let conversationHistory = [];
let isLoading = false;

// ── OLLAMA API HELPER ──
// Ollama's OpenAI-compatible endpoint — no API key needed
function ollamaFetch(messages) {
  return fetch(`${PROXY_URL}/ollama/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: false,
      options: {
        temperature: 0.3,
        num_predict: 1000
      }
    })
  }).then(r => r.json());
}

// ── STREAMING RESPONSE (Ollama) ──
// Ollama streaming: newline-delimited JSON objects
async function streamResponse(messages) {
  removeTyping();
  const bodyEl = appendStreamingMessage();
  const msgs = document.getElementById('messages');
  let fullText = '';

  const res = await fetch(`${PROXY_URL}/ollama/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: true,
      options: {
        temperature: 0.3,
        num_predict: 1000
      }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(errText || `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = decoder.decode(value).split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const chunk = JSON.parse(line);
        const token = chunk.message?.content;
        if (token) {
          fullText += token;
          bodyEl.innerHTML = renderMarkdown(fullText);
          msgs.scrollTop = msgs.scrollHeight;
        }
      } catch {}
    }
  }
  return fullText || (currentLang === 'tr' ? 'Yanıt alınamadı.' : 'No response received.');
}

// ── BUILD STUDENT CONTEXT ──
// Collects all student data and injects it as a structured block
function buildStudentContext(student) {
  const sid = student.student_id;
  const info = executeTool('get_student_info', { student_id: sid });
  const graduation = executeTool('calculate_graduation_estimate', { student_id: sid });
  const remaining = executeTool('list_remaining_courses', { student_id: sid });

  return `
══════ STUDENT ACADEMIC DATA ══════
${JSON.stringify(info, null, 2)}

══════ GRADUATION ESTIMATE ══════
${JSON.stringify(graduation, null, 2)}

══════ REMAINING COURSES ══════
${JSON.stringify(remaining, null, 2)}
══════════════════════════════════
`;
}

// ── MAIN CHAT FUNCTION ──
// Handles user message — single Ollama call with student data in context
async function chat(userMessage) {
  if (!selectedStudent || isLoading) return;
  isLoading = true;
  document.getElementById('send-btn').disabled = true;
  document.getElementById('input-box').disabled = true;

  conversationHistory.push({ role: 'user', content: userMessage });
  appendMessage('user', userMessage);
  appendTyping();

  // Inject student data context into the first user message
  const studentContext = buildStudentContext(selectedStudent);
  const messagesWithContext = conversationHistory.map((m, i) => {
    if (i === 0 && m.role === 'user') {
      return { ...m, content: `${studentContext}\n\nStudent question: ${m.content}` };
    }
    return m;
  });

  try {
    let assistantText = '';

    // ── SINGLE CALL — system prompt + student data + question → Ollama ──
    const systemPrompt = buildSystemPrompt(currentMemories, currentLang);
    const baseMessages = [
      { role: 'system', content: systemPrompt },
      ...messagesWithContext
    ];

    assistantText = await streamResponse(baseMessages);

    conversationHistory.push({ role: 'assistant', content: assistantText });

    // ── SAVE MEMORY (background task, non-blocking) ──
    saveMemory(selectedStudent.student_id, userMessage, assistantText);

  } catch(e) {
    removeTyping();
    appendMessage('assistant', currentLang === 'tr' ? `⚠️ Ollama hatası: ${e.message}` : `⚠️ Ollama error: ${e.message}`);
  }

  isLoading = false;
  document.getElementById('send-btn').disabled = false;
  document.getElementById('input-box').disabled = false;
  document.getElementById('input-box').focus();
}

