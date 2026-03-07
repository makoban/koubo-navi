"""公募ナビAI - Gemini API クライアント（バッチ用）"""

import json
import logging
import re
import time

import requests

import config

logger = logging.getLogger(__name__)

_MAX_RETRIES = 3
_RETRY_BASE_WAIT = 30  # 429発生時の初回待機秒数（指数バックオフ）


def call_gemini(prompt: str, json_mode: bool = True, max_tokens: int = 8192) -> str:
    """Gemini API を呼び出してテキスト応答を返す。

    429 レート制限エラー時は指数バックオフで最大3回リトライする。
    APIキーはURLクエリパラメータではなく x-goog-api-key ヘッダーで送信する。
    """
    url = f"{config.GEMINI_ENDPOINT}/{config.GEMINI_MODEL}:generateContent"

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

    headers = {
        "x-goog-api-key": config.GEMINI_API_KEY,
        "Content-Type": "application/json",
    }

    for attempt in range(_MAX_RETRIES):
        resp = requests.post(url, headers=headers, json=payload, timeout=120)

        if resp.status_code == 429:
            # レート制限: 指数バックオフで待機してリトライ
            wait = _RETRY_BASE_WAIT * (2 ** attempt)
            logger.warning(
                "Gemini rate limit (429). %d秒待機 (attempt %d/%d)",
                wait, attempt + 1, _MAX_RETRIES,
            )
            time.sleep(wait)
            continue

        resp.raise_for_status()
        data = resp.json()

        candidates = data.get("candidates", [])
        if not candidates:
            raise ValueError("Gemini returned no candidates")

        text = candidates[0]["content"]["parts"][0]["text"]
        return text

    raise RuntimeError(f"Gemini API: {_MAX_RETRIES}回リトライ後も429")


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
        try:
            repaired = _repair_json(text)
            return json.loads(repaired)
        except json.JSONDecodeError:
            # 最終手段: テキスト内の最初の { } ブロックを抽出
            match = re.search(r"\{.*\}", text, re.DOTALL)
            if match:
                return json.loads(match.group())
            raise


def _count_unbalanced(text: str, open_char: str, close_char: str) -> int:
    """文字列リテラルの外側にある未閉じの open_char の個数を返す。"""
    count = 0
    in_string = False
    escaped = False
    for ch in text:
        if escaped:
            escaped = False
            continue
        if ch == "\\" and in_string:
            escaped = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if not in_string:
            if ch == open_char:
                count += 1
            elif ch == close_char:
                count -= 1
    return count


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

    # 開いた括弧/ブレースを閉じる（文字列内の括弧は除外してカウント）
    open_braces = _count_unbalanced(text, "{", "}")
    open_brackets = _count_unbalanced(text, "[", "]")
    text += "}" * max(0, open_braces)
    text += "]" * max(0, open_brackets)

    return text
