"""
Graduation Chatbot — MCP Memory Proxy
======================================
HTML <-> this proxy <-> MCP Memory Server (npx @modelcontextprotocol/server-memory)

Setup:
  1. pip install flask flask-cors
  2. Run: python3 proxy.py
  3. Open browser: http://localhost:5050
"""

import json
import os
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Allow cross-origin requests from the HTML frontend

# ── MCP Memory Server Communication ─────────────────────────────────────────
# server-memory runs in stdio mode — JSON-RPC messages over stdin/stdout
MCP_PROCESS = None
MCP_LOCK    = threading.Lock()
REQUEST_ID  = 0

def get_request_id():
    global REQUEST_ID
    REQUEST_ID += 1
    return REQUEST_ID

def start_mcp_server():
    """Start npx @modelcontextprotocol/server-memory as a subprocess."""
    global MCP_PROCESS
    # Point MCP's data file to memory/memory.json in the project directory
    memory_file = Path("memory/memory.json").absolute()
    memory_file.parent.mkdir(exist_ok=True)
    try:
        MCP_PROCESS = subprocess.Popen(
            ["npx", "-y", "@modelcontextprotocol/server-memory"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env={**os.environ, "MEMORY_FILE_PATH": str(memory_file)}
        )
        # Initial handshake
        _mcp_call("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities":    {},
            "clientInfo":      {"name": "mezuniyet-proxy", "version": "0.1"}
        })
        print("✅ MCP Memory Server started")
        print(f"💾 Data file: memory/memory.json")
    except FileNotFoundError:
        print("⚠️  npx not found — is Node.js installed?")
        print("   Fallback: will write to JSON file directly")

def _mcp_call(method: str, params: dict) -> dict:
    """Send a JSON-RPC request to MCP server, return the response."""
    if MCP_PROCESS is None or MCP_PROCESS.poll() is not None:
        return {"error": "MCP server not running"}

    req = json.dumps({
        "jsonrpc": "2.0",
        "id":      get_request_id(),
        "method":  method,
        "params":  params
    }) + "\n"

    with MCP_LOCK:
        try:
            MCP_PROCESS.stdin.write(req)
            MCP_PROCESS.stdin.flush()
            # Response comes line by line
            raw = MCP_PROCESS.stdout.readline()
            return json.loads(raw) if raw.strip() else {}
        except Exception as e:
            return {"error": str(e)}

def mcp_create_entities(student_id: str, memories: list[dict]) -> dict:
    """Write an entity + observations for a student."""
    entities   = [{"name": student_id, "entityType": "student", "observations": []}]
    relations  = []
    for m in memories:
        obs = m.get("content", "")
        entities[0]["observations"].append(obs)
    return _mcp_call("tools/call", {
        "name":      "create_entities",
        "arguments": {"entities": entities}
    })

def mcp_add_observations(student_id: str, observations: list[str]) -> dict:
    return _mcp_call("tools/call", {
        "name":      "add_observations",
        "arguments": {"observations": [
            {"entityName": student_id, "contents": observations}
        ]}
    })

def mcp_search_nodes(query: str) -> dict:
    return _mcp_call("tools/call", {
        "name":      "search_nodes",
        "arguments": {"query": query}
    })

def mcp_read_graph() -> dict:
    return _mcp_call("tools/call", {
        "name":      "read_graph",
        "arguments": {}
    })

# ── Helpers ──────────────────────────────────────────────────────────────────
def is_mcp_alive() -> bool:
    return MCP_PROCESS is not None and MCP_PROCESS.poll() is None

# ── API ROUTES ───────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(".", "chatbot.html")


@app.route("/css/<path:filename>")
def serve_css(filename):
    return send_from_directory("css", filename)


@app.route("/js/<path:filename>")
def serve_js(filename):
    return send_from_directory("js", filename)


@app.route("/students.json")
def serve_students():
    return send_from_directory(".", "students.json")


@app.route("/health")
def health():
    return jsonify({
        "status": "ok",
        "mcp":    is_mcp_alive(),
        "time":   datetime.now().isoformat()
    })


# ── Ollama Proxy (avoids browser CORS issues) ───────────────────────────────
import requests as http_requests

OLLAMA_URL = "http://localhost:11434"

@app.route("/ollama/api/chat", methods=["POST"])
def ollama_chat():
    """Proxy chat requests to local Ollama instance."""
    body = request.get_json(force=True)
    is_stream = body.get("stream", False)

    try:
        resp = http_requests.post(
            f"{OLLAMA_URL}/api/chat",
            json=body,
            stream=is_stream,
            timeout=120
        )

        if is_stream:
            def generate():
                for chunk in resp.iter_content(chunk_size=None):
                    yield chunk
            return app.response_class(generate(), mimetype='application/x-ndjson')
        else:
            return jsonify(resp.json())
    except http_requests.exceptions.ConnectionError:
        return jsonify({"error": "Ollama is not running at " + OLLAMA_URL}), 503
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/memory/<student_id>", methods=["GET"])
def get_memory(student_id: str):
    """Return the student's past chat summaries. Called when a student is selected."""
    if not is_mcp_alive():
        return jsonify({"student_id": student_id, "memories": [], "source": "offline"})

    result = mcp_search_nodes(student_id)
    nodes = (result.get("result", {})
                   .get("content", [{}])[0]
                   .get("text", "{}"))
    try:
        parsed   = json.loads(nodes)
        entities = parsed.get("entities", [])
        memories = []
        for e in entities:
            if e.get("name") == student_id:
                memories = e.get("observations", [])
        return jsonify({"student_id": student_id, "memories": memories, "source": "mcp"})
    except Exception:
        return jsonify({"student_id": student_id, "memories": [], "source": "mcp_parse_error"})


@app.route("/memory/<student_id>", methods=["POST"])
def save_memory(student_id: str):
    """Called after a conversation ends. Body: { "summary": "..." }"""
    body    = request.get_json(force=True)
    summary = body.get("summary", "").strip()
    if not summary:
        return jsonify({"error": "summary cannot be empty"}), 400

    if not is_mcp_alive():
        return jsonify({"ok": False, "error": "MCP server not running"})

    mcp_create_entities(student_id, [])
    mcp_add_observations(student_id, [summary])
    return jsonify({"ok": True, "source": "mcp"})


@app.route("/memory/<student_id>", methods=["DELETE"])
def clear_memory(student_id: str):
    """Debug: clear a student's memory."""
    # MCP entity deletion — uses server-memory's delete_entities tool
    result = _mcp_call("tools/call", {
        "name":      "delete_entities",
        "arguments": {"entityNames": [student_id]}
    })
    return jsonify({"ok": True, "cleared": student_id, "mcp": result})


@app.route("/memory", methods=["GET"])
def list_all():
    """Dump all memory — debug endpoint."""
    if not is_mcp_alive():
        return jsonify({"source": "offline", "entities": []})
    result = mcp_read_graph()
    return jsonify({"source": "mcp", "graph": result})


# ── START ────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("🚀 Starting MCP Memory Proxy...")
    # Start MCP server in background
    t = threading.Thread(target=start_mcp_server, daemon=True)
    t.start()
    time.sleep(2)  # Wait for MCP server to come up
    print("📡 Proxy running at http://localhost:5050")
    print("   GET  /health              — health check")
    print("   GET  /memory/<student_id> — fetch memory")
    print("   POST /memory/<student_id> — save summary")
    print("   GET  /memory              — all memory (debug)")
    app.run(port=5050, debug=False)