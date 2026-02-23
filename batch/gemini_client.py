"""公募ナビAI - Gemini API クライアント（バッチ用）"""

import json
import logging

import requests

import config

logger = logging.getLogger(__name__)


def call_gemini(prompt: str, json_mode: bool = True, max_tokens: int = 8192) -> str:
    """Gemini API を呼び出してテキスト応答を返す。"""
    url = (
        f"{config.GEMINI_ENDPOINT}/{config.GEMINI_MODEL}"
        f":generateContent?key={config.GEMINI_API_KEY}"
    )

    gen_config = {
        "temperature": 0.2,
        "maxOutputTokens": max_tokens,
    }
    if json_mode:
        gen_config["responseMimeType"] = "application/json"

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": gen_config,
    }

    resp = requests.post(url, json=payload, timeout=120)
    resp.raise_for_status()
    data = resp.json()

    candidates = data.get("candidates", [])
    if not candidates:
        raise ValueError("Gemini returned no candidates")

    text = candidates[0]["content"]["parts"][0]["text"]
    return text


def parse_json_response(text: str):
    """Gemini の応答から JSON をパースする。マークダウンコードブロックにも対応。"""
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        end = len(lines) - 1
        while end > 0 and not lines[end].strip().startswith("```"):
            end -= 1
        text = "\n".join(lines[1:end])
    return json.loads(text)
