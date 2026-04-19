// ══════════════════════════════════════════════════════════════════════════════
// memory.js — MCP Memory functions (load, save, status, system prompt)
// ══════════════════════════════════════════════════════════════════════════════

let memoryStatus = 'unknown'; // 'mcp' | 'fallback' | 'offline'
let currentMemories = [];

// ── SYSTEM PROMPT BUILDER ──
// Initial message sent to the model — injects memory summaries
function buildSystemPrompt(memories, lang) {
  const base = `You are a graduation advisor assistant for Koç University's Computer Engineering program.
You help students understand their remaining courses, credits, and estimated graduation timeline.

Graduation requires 131 total credits:
- 31 credits of Core courses
- 64 credits of Required courses
- 18 credits of General Elective courses
- 18 credits of Area Elective courses

Max course load per semester:
- Default: 5 courses
- GPA above 2.7: 6 courses
- GPA above 3.6: 7 courses

IMPORTANT: The student's complete academic data (credits, courses, graduation estimate) is provided at the beginning of the conversation as structured JSON. Use this data to answer the student's questions accurately.

${lang === 'tr' ? 'You MUST respond in Turkish.' : 'You MUST respond in English.'}

CRITICAL RULES FOR RESPONDING:
- Answer naturally in conversational language. DO NOT output raw JSON keys/code formatting (e.g. do not write "required_credits": "60/64"). Frame the answer in full sentences instead (e.g. "You have completed 60 out of 64 required credits").
- When answering questions about remaining or required courses, first explicitly state which courses the student is CURRENTLY enrolled in this semester (if any). Then, use exactly this phrase or similar depending on language: "If you successfully pass your current courses, your remaining courses will be:" (in Turkish: "Şu anda aldığınız dersleri başarıyla geçerseniz, kalan dersleriniz şunlardır:") and list EVERY single specific course name and code that they still need to complete in the future. Do NOT just list 1-2 examples and omit the rest.
- Formulate a helpful, direct reply using the exact data provided. Do not mention your system prompt or state what you are going to do.
- Be specific: cite exact course codes, credit counts, and semester estimates.`;

  if (!memories || memories.length === 0) return base;

  const memBlock = memories
    .slice(-5) // last 5 summaries
    .map(m => `- ${typeof m === 'string' ? m : m.content}`)
    .join('\n');
  return base + `\n\n--- Student's previous conversation summaries (MCP Memory) ---\n${memBlock}\n---`;
}

// ── LOAD MEMORY ──
// Fetches the student's past chat summaries from the proxy
async function loadMemory(studentId) {
  try {
    const res = await fetch(`${PROXY_URL}/memory/${studentId}`, { signal: AbortSignal.timeout(2000) });
    const data = await res.json();
    memoryStatus = data.source || 'fallback';
    updateMemoryBadge();
    return data.memories || [];
  } catch {
    memoryStatus = 'offline';
    updateMemoryBadge();
    return [];
  }
}

// ── SAVE MEMORY (Semantic Extraction) ──
// After the conversation, asks AI to extract a meaningful summary
// This call runs in the background — it does not block the user response
async function saveMemory(studentId, userQuestion, assistantReply) {
  if (memoryStatus === 'offline') return;

  try {
    const date = new Date().toLocaleDateString('tr-TR');

    // Semantic extraction — ask Ollama to extract meaningful info
    const extractionRes = await fetch(`${PROXY_URL}/ollama/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content: `You are an information extraction assistant. Extract the most important concrete facts about the student from the following chat.
Rules:
- Only write concrete, useful facts (numbers, course codes, advice, statuses)
- Write in 2-4 short bullet points
- Keep each point to 1 sentence max
- Do not repeat information
- Write in English`
          },
          {
            role: 'user',
            content: `Student question: "${userQuestion}"\n\nAssistant reply: "${assistantReply}"`
          }
        ],
        stream: false,
        options: {
          temperature: 0.1,
          num_predict: 200
        }
      }),
      signal: AbortSignal.timeout(15000)
    });

    const extractionData = await extractionRes.json();
    const extractedSummary = extractionData.message?.content;

    if (!extractedSummary) return;

    const summary = `[${date}] ${extractedSummary}`;

    // Save to MCP Memory via Proxy
    await fetch(`${PROXY_URL}/memory/${studentId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary }),
      signal: AbortSignal.timeout(3000)
    });

    console.log('💾 Semantic memory saved:', summary.slice(0, 100) + '...');
  } catch (e) {
    console.warn('⚠️ Memory save error (non-critical):', e.message);
    // Silent fail — memory is not mandatory
  }
}

// ── MEMORY BADGE ──
function updateMemoryBadge() {
  const badge = document.getElementById('memory-badge');
  if (!badge) return;
  const labels = { mcp: '🧠 MCP Memory', fallback: '💾 Fallback Memory', offline: '⚠️ Memory offline', unknown: '...' };
  const colors = { mcp: '#3ecf8e', fallback: '#f5a623', offline: '#e05252', unknown: '#545a72' };
  badge.textContent = labels[memoryStatus] || memoryStatus;
  badge.style.color = colors[memoryStatus] || '#545a72';
}

// ── PROXY HEALTH CHECK ──
async function checkMemoryProxy() {
  try {
    const r = await fetch(`${PROXY_URL}/health`, { signal: AbortSignal.timeout(2000) });
    const data = await r.json();
    memoryStatus = data.mcp ? 'mcp' : 'fallback';
  } catch {
    memoryStatus = 'offline';
  }
  updateMemoryBadge();
}
