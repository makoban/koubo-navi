"""公募ナビAI - Slack通知モジュール

エラーやヘルスチェック結果をSlack Incoming Webhookで通知する。
"""

import logging
import os

import requests

logger = logging.getLogger(__name__)

SLACK_WEBHOOK_URL = os.environ.get("SLACK_WEBHOOK_URL", "")


def notify_slack(title, detail=""):
    """エラー通知をSlackに送信"""
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
    """ヘルスチェック結果をSlackに送信（項目リスト付き）"""
    if not SLACK_WEBHOOK_URL:
        return
    text = f"*[公募ナビAI]*\n*{title}*\n"
    for item in items:
        text += f"\n{item}"
    try:
        requests.post(SLACK_WEBHOOK_URL, json={"text": text}, timeout=10)
    except Exception:
        pass
