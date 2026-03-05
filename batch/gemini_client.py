"""公募ナビAI - Gemini API クライアント（バッチ用）"""

import json
import logging
import re

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
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        repaired = _repair_json(text)
        return json.loads(repaired)


def _repair_json(text: str) -> str:
    """壊れたJSONの修復を試みる。"""
    # 未閉じの文字列を閉じる
    in_string = False
    escaped = False
    for ch in text:
        if escaped:
            escaped = False
            continue
        if ch == "\\":
            escaped = True
            continue
        if ch == '"':
            in_string = not in_string
    if in_string:
        text += '"'

    # 末尾のカンマを除去（閉じ括弧/ブレースの直前、または末尾）
    text = re.sub(r",\s*([}\]])", r"\1", text)
    text = re.sub(r",\s*$", "", text)

    # 開いた括弧/ブレースを閉じる
    open_braces = text.count("{") - text.count("}")
    open_brackets = text.count("[") - text.count("]")
    text += "}" * max(0, open_braces)
    text += "]" * max(0, open_brackets)

    return text
