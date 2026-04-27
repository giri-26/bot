"""
Ollama Chatbot Backend - app.py
================================
Install:  pip install flask flask-cors requests pillow
Models:   ollama pull llama3   (text)
          ollama pull llava    (vision/image understanding)
Run:      python app.py
Open:     http://localhost:5000
"""

import os, json, base64, requests
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory, Response, stream_with_context
from flask_cors import CORS

app = Flask(__name__, static_folder=".")
CORS(app)

OLLAMA_BASE   = os.getenv("OLLAMA_HOST", "http://localhost:11434")
DEFAULT_MODEL = os.getenv("OLLAMA_MODEL", "llama3")
VISION_MODEL  = os.getenv("OLLAMA_VISION", "llava")

Path("uploads").mkdir(exist_ok=True)

# ── System prompt ──────────────────────────────────────────────────────────────
def build_system(mode, language, short, step):
    prompts = {
        "general": "You are a helpful, friendly, and accurate AI assistant.",
        "study":   "You are a patient tutor. Explain concepts clearly with real examples.",
        "coding":  "You are an expert software engineer. Provide clean, commented code with clear explanations.",
    }
    sys = prompts.get(mode, prompts["general"])
    if language and language.lower() != "english":
        sys += f" Always respond in {language}."
    if short:
        sys += " Be very concise — max 3 sentences unless code is needed."
    if step:
        sys += " Always structure your answer as clear numbered steps."
    return sys

# ── Routes ─────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(".", "index.html")

@app.route("/<path:f>")
def static_files(f):
    return send_from_directory(".", f)

@app.route("/api/models")
def get_models():
    try:
        r = requests.get(f"{OLLAMA_BASE}/api/tags", timeout=5)
        models = [m["name"] for m in r.json().get("models", [])]
        return jsonify({"models": models or [DEFAULT_MODEL]})
    except:
        return jsonify({"models": [DEFAULT_MODEL]})

@app.route("/api/chat", methods=["POST"])
def chat():
    d        = request.json or {}
    history  = d.get("history", [])
    message  = d.get("message", "").strip()
    mode     = d.get("mode", "general")
    language = d.get("language", "English")
    short    = d.get("short_mode", False)
    step     = d.get("step_mode", False)
    model    = d.get("model", DEFAULT_MODEL)
    image_b64= d.get("image")

    if not message and not image_b64:
        return jsonify({"error": "Empty message"}), 400

    active_model = VISION_MODEL if image_b64 else model
    user_msg = {"role": "user", "content": message or "Describe this image in detail."}
    if image_b64:
        user_msg["images"] = [image_b64]

    messages = [{"role": "system", "content": build_system(mode, language, short, step)}] + history + [user_msg]

    def generate():
        try:
            resp = requests.post(
                f"{OLLAMA_BASE}/api/chat",
                json={"model": active_model, "messages": messages, "stream": True},
                stream=True, timeout=120,
            )
            resp.raise_for_status()
            for line in resp.iter_lines():
                if line:
                    try:
                        chunk = json.loads(line)
                        token = chunk.get("message", {}).get("content", "")
                        if token:
                            yield f"data: {json.dumps({'token': token})}\n\n"
                        if chunk.get("done"):
                            yield f"data: {json.dumps({'done': True})}\n\n"
                    except:
                        pass
        except requests.exceptions.ConnectionError:
            yield f"data: {json.dumps({'error': 'Cannot connect to Ollama. Is it running?'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return Response(stream_with_context(generate()), mimetype="text/event-stream")

@app.route("/api/generate-image", methods=["POST"])
def generate_image():
    """Uses Pollinations.ai (free, no API key) for image generation."""
    prompt = (request.json or {}).get("prompt", "").strip()
    if not prompt:
        return jsonify({"error": "No prompt"}), 400
    encoded   = requests.utils.quote(prompt)
    image_url = f"https://image.pollinations.ai/prompt/{encoded}?width=512&height=512&nologo=true&seed={hash(prompt) % 99999}"
    return jsonify({"image_url": image_url})

@app.route("/api/upload-image", methods=["POST"])
def upload_image():
    if "file" not in request.files:
        return jsonify({"error": "No file"}), 400
    file = request.files["file"]
    b64  = base64.b64encode(file.read()).decode()
    return jsonify({"base64": b64, "mime": file.content_type})

# ── Run ────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("\n" + "="*55)
    print("  🤖  Ollama Chatbot")
    print(f"  📡  Ollama → {OLLAMA_BASE}")
    print(f"  🧠  Model  → {DEFAULT_MODEL}")
    print("  🌐  Open   → http://localhost:5000")
    print("="*55 + "\n")
    app.run(debug=True, port=5000, threaded=True)
