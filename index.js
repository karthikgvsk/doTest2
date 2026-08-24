const express = require("express");

const app = express();
const port = process.env.PORT || 8080;

const DO_TOKEN = process.env.DO_API_TOKEN;
if (!DO_TOKEN) {
  console.error("Error: DO_API_TOKEN environment variable is not set.");
  process.exit(1);
}
const INFERENCE_BASE = "https://inference.do-ai.run/v1";

const NON_CHAT_PATTERNS = [
  "fal-ai/", "stable-diffusion", "gte-", "all-mini", "e5-large",
  "bge-", "multi-qa", "qwen3-embedding", "wan2", "ideogram",
  "gpt-image", "tts", "text-to-audio", "embedding", "reranker",
  "router:",
];

function isChatModel(id) {
  return !NON_CHAT_PATTERNS.some((p) => id.toLowerCase().includes(p));
}

app.use(express.json());

// Request logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

// --- API routes ---

app.get("/api/models", async (req, res) => {
  console.log("[GET /api/models] Fetching model list...");
  try {
    const response = await fetch(`${INFERENCE_BASE}/models`, {
      headers: { Authorization: `Bearer ${DO_TOKEN}` },
    });
    const data = await response.json();
    const chatModels = (data.data || [])
      .filter((m) => isChatModel(m.id))
      .map((m) => ({ id: m.id }));
    console.log(`[GET /api/models] Returned ${chatModels.length} models`);
    res.json({ models: chatModels });
  } catch (err) {
    console.error("[GET /api/models] Error:", err.message);
    res.status(500).json({ error: "Failed to fetch models" });
  }
});

app.post("/api/chat", async (req, res) => {
  const { modelId, messages } = req.body;
  console.log(`[POST /api/chat] model=${modelId} messages=${messages.length}`);
  try {
    const response = await fetch(`${INFERENCE_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DO_TOKEN}`,
      },
      body: JSON.stringify({ model: modelId, messages }),
    });
    const data = await response.json();
    if (!response.ok) {
      const message = data?.error?.message || data?.message || "Request failed";
      console.error(`[POST /api/chat] Error from DO (${response.status}): ${message}`);
      return res.status(response.status).json({ error: message });
    }
    const tokens = data.usage?.total_tokens ?? "unknown";
    console.log(`[POST /api/chat] model=${modelId} status=200 tokens=${tokens}`);
    res.json(data);
  } catch (err) {
    console.error(`[POST /api/chat] Unexpected error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Serve UI ---

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DigitalOcean · Model Comparison</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0f172a; color: #e2e8f0; font-family: system-ui, -apple-system, sans-serif; height: 100vh; display: flex; flex-direction: column; }
    ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #1e293b; } ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }

    #header { background: #1e3a5f; padding: 14px 24px; border-bottom: 1px solid #1e40af; flex-shrink: 0; }
    #header h1 { font-size: 20px; font-weight: 700; color: #60a5fa; }
    #header p { font-size: 13px; color: #94a3b8; margin-top: 4px; }

    #body { display: flex; flex: 1; overflow: hidden; }

    /* Sidebar */
    #sidebar { width: 260px; background: #1e293b; border-right: 1px solid #334155; display: flex; flex-direction: column; flex-shrink: 0; }
    #sidebar-header { padding: 12px 16px; border-bottom: 1px solid #334155; }
    #sidebar-label { font-size: 11px; font-weight: 600; color: #64748b; letter-spacing: 0.08em; display: block; margin-bottom: 8px; }
    #search { width: 100%; background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 6px 10px; color: #e2e8f0; font-size: 12px; outline: none; }
    #search:focus { border-color: #2563eb; }
    #model-list { flex: 1; overflow-y: auto; padding: 6px 0; }
    .model-row { display: flex; align-items: flex-start; gap: 8px; padding: 7px 16px; cursor: pointer; }
    .model-row:hover, .model-row.selected { background: #1e3a5f; }
    .model-row label { font-size: 13px; line-height: 1.4; cursor: pointer; }
    #model-count { padding: 8px 16px; font-size: 11px; color: #475569; border-top: 1px solid #334155; }

    /* Main */
    #main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    #prompt-bar { padding: 20px; background: #1e293b; border-bottom: 1px solid #334155; flex-shrink: 0; }
    #prompt { width: 100%; background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 10px 14px; color: #e2e8f0; font-size: 14px; resize: vertical; outline: none; font-family: inherit; line-height: 1.5; }
    #prompt:focus { border-color: #2563eb; }
    #actions { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
    #run-btn { padding: 8px 20px; background: #2563eb; border: none; border-radius: 6px; color: #fff; font-weight: 600; font-size: 14px; cursor: pointer; }
    #run-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    #hint { font-size: 12px; color: #475569; }

    /* Results */
    #results { flex: 1; overflow-y: auto; padding: 20px; }
    #empty { text-align: center; padding-top: 80px; color: #475569; }
    #empty .icon { font-size: 44px; margin-bottom: 12px; }
    #grid { display: grid; gap: 16px; align-items: start; }
    .result-card { background: #1e293b; border-radius: 8px; border: 1px solid #334155; overflow: hidden; }
    .result-card-header { padding: 9px 14px; background: #1e3a5f; border-bottom: 1px solid #1e40af; font-size: 13px; font-weight: 600; color: #60a5fa; }
    .result-card-body { padding: 14px; font-size: 13px; line-height: 1.7; white-space: pre-wrap; min-height: 80px; color: #cbd5e1; }
    .result-card-body.loading { color: #64748b; }
    .result-card-body.error { color: #f87171; }
  </style>
</head>
<body>

<div id="header">
  <h1>DigitalOcean · Model Comparison</h1>
  <p>Run your prompt across multiple models and compare results side by side</p>
</div>

<div id="body">
  <div id="sidebar">
    <div id="sidebar-header">
      <span id="sidebar-label">MODELS</span>
      <input id="search" type="text" placeholder="Search..." />
    </div>
    <div id="model-list"><div style="padding:12px 16px;color:#475569;font-size:13px">Loading models...</div></div>
    <div id="model-count">0 selected</div>
  </div>

  <div id="main">
    <div id="prompt-bar">
      <textarea id="prompt" rows="4" placeholder="Enter your prompt here…"></textarea>
      <div id="actions">
        <button id="run-btn" disabled>Compare 0 models</button>
        <span id="hint">⌘ + Enter to run</span>
      </div>
    </div>
    <div id="results">
      <div id="empty"><div class="icon">⚡</div><div>Select models on the left and enter a prompt to compare</div></div>
      <div id="grid" style="display:none"></div>
    </div>
  </div>
</div>

<script>
  const path = window.location.pathname;
  const BASE = path.endsWith('/') ? path.slice(0, -1) : path;
  let allModels = [];
  let selected = new Set();

  // Load models
  fetch(BASE + '/api/models')
    .then(r => r.json())
    .then(data => {
      allModels = data.models || [];
      renderModels(allModels);
    })
    .catch(() => {
      document.getElementById('model-list').innerHTML =
        '<div style="padding:12px 16px;color:#f87171;font-size:13px">Failed to load models</div>';
    });

  function renderModels(models) {
    const list = document.getElementById('model-list');
    if (!models.length) {
      list.innerHTML = '<div style="padding:12px 16px;color:#475569;font-size:13px">No models found</div>';
      return;
    }
    list.innerHTML = models.map(m => \`
      <div class="model-row \${selected.has(m.id) ? 'selected' : ''}" data-id="\${m.id}">
        <input type="checkbox" id="cb_\${m.id}" \${selected.has(m.id) ? 'checked' : ''} />
        <label for="cb_\${m.id}">\${m.id}</label>
      </div>
    \`).join('');
    list.querySelectorAll('.model-row').forEach(row => {
      row.addEventListener('click', () => toggleModel(row.dataset.id));
    });
  }

  function toggleModel(id) {
    selected.has(id) ? selected.delete(id) : selected.add(id);
    renderModels(filterModels());
    updateCount();
    updateRunBtn();
  }

  function filterModels() {
    const q = document.getElementById('search').value.toLowerCase();
    return allModels.filter(m => m.id.toLowerCase().includes(q));
  }

  function updateCount() {
    document.getElementById('model-count').textContent = selected.size + ' selected';
    document.getElementById('sidebar-label').textContent =
      'MODELS · ' + selected.size + ' selected';
  }

  function updateRunBtn() {
    const btn = document.getElementById('run-btn');
    const prompt = document.getElementById('prompt').value.trim();
    const count = selected.size;
    btn.disabled = !prompt || count === 0;
    btn.textContent = 'Compare ' + count + ' model' + (count !== 1 ? 's' : '');
  }

  document.getElementById('search').addEventListener('input', () => renderModels(filterModels()));
  document.getElementById('prompt').addEventListener('input', updateRunBtn);
  document.getElementById('prompt').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runComparison();
  });
  document.getElementById('run-btn').addEventListener('click', runComparison);

  async function runComparison() {
    const prompt = document.getElementById('prompt').value.trim();
    if (!prompt || !selected.size) return;

    const ids = [...selected];
    const grid = document.getElementById('grid');
    const empty = document.getElementById('empty');
    empty.style.display = 'none';
    grid.style.display = 'grid';

    const cols = ids.length === 1 ? '1fr' : ids.length === 2 ? '1fr 1fr' : '1fr 1fr 1fr';
    grid.style.gridTemplateColumns = cols;

    // Render loading cards
    grid.innerHTML = ids.map(id => \`
      <div class="result-card" id="card_\${id.replace(/[^a-z0-9]/gi,'_')}">
        <div class="result-card-header">\${id}</div>
        <div class="result-card-body loading">Generating response…</div>
      </div>
    \`).join('');

    document.getElementById('run-btn').disabled = true;

    await Promise.all(ids.map(async id => {
      const cardId = 'card_' + id.replace(/[^a-z0-9]/gi,'_');
      try {
        const resp = await fetch(BASE + '/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modelId: id, messages: [{ role: 'user', content: prompt }] }),
        });
        const data = await resp.json();
        const body = document.querySelector('#' + cardId + ' .result-card-body');
        if (data.error) {
          body.className = 'result-card-body error';
          body.textContent = data.error.toLowerCase().includes('subscription')
            ? 'Not available on your current plan'
            : data.error;
        } else {
          body.className = 'result-card-body';
          body.textContent = data.choices?.[0]?.message?.content || JSON.stringify(data);
        }
      } catch (err) {
        const body = document.querySelector('#' + cardId + ' .result-card-body');
        body.className = 'result-card-body error';
        body.textContent = err.message;
      }
    }));

    updateRunBtn();
  }
</script>
</body>
</html>`);
});

app.listen(port, () => {
  console.log(`[${new Date().toISOString()}] App running on http://localhost:${port}`);
  console.log(`[${new Date().toISOString()}] Inference base: ${INFERENCE_BASE}`);
  console.log(`[${new Date().toISOString()}] DO_API_TOKEN: ${DO_TOKEN ? "set ✓" : "missing ✗"}`);
});
