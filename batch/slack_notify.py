"""公募ナビAI - Slack通知 + エラーログ記録モジュール

エラーやヘルスチェック結果をSlack Incoming Webhookで通知し、
同時にSupabaseのerror_logsテーブルに記録する。
"""

import logging
import os

import requests

logger = logging.getLogger(__name__)

SLACK_WEBHOOK_URL = os.environ.get("SLACK_WEBHOOK_URL", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://ypyrjsdotkeyvzequdez.supabase.co")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def _log_to_db(source, title, detail=""):
    """エラーログをSupabase error_logsテーブルに記録"""
    if not SUPABASE_SERVICE_KEY:
        return
    try:
        requests.post(
            f"{SUPABASE_URL}/rest/v1/error_logs",
            headers={
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            json={"source": source, "title": title, "detail": detail[:5000] if detail else ""},
            timeout=10,
        )
    except Exception:
        logger.debug("error_logs書き込み失敗", exc_info=True)


def notify_slack(title, detail=""):
    """エラー通知をSlackに送信 + DBに記録"""
    _log_to_db("batch", title, detail)
    if not SLACK_WEBHOOK_URL:
        logger.debug("SLACK_WEBHOOK_URL 未設定のため通知スキップ")
        return
    text = f"*[公募ナビAI]*\n*{title}*"
    if detail:
        text += f"\n```{detail}```"
    try:
        requests.post(SLACK_WEBHOOK_URL, json={"text": text}, timeout=10)
    except Exception:
        pass


def notify_slack_health(title, items):
    """ヘルスチェック結果をSlackに送信 + DBに記録"""
    detail = "\n".join(items)
    _log_to_db("batch", title, detail)
    if not SLACK_WEBHOOK_URL:
        return
    text = f"*[公募ナビAI]*\n*{title}*\n"
    for item in items:
        text += f"\n{item}"
    try:
        requests.post(SLACK_WEBHOOK_URL, json={"text": text}, timeout=10)
    except Exception:
        pass
