#!/usr/bin/env python3
"""公募ナビAI - バッチエントリーポイント

Render.com Cron Job から実行される。
毎日 JST 02:00（UTC 17:00）にスクレイピング → マッチング → 通知を実行。
"""

import logging
import os
import sys

# batch/ ディレクトリをパスに追加
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config
from daily_check import run_daily_check
from slack_notify import notify_slack

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


def main():
    logger.info("公募ナビAI バッチ処理開始")

    # 必須環境変数チェック
    if not config.GEMINI_API_KEY:
        logger.critical("GEMINI_API_KEY が設定されていません")
        notify_slack("環境変数エラー", "GEMINI_API_KEY が設定されていません")
        sys.exit(1)

    if not config.SUPABASE_SERVICE_KEY:
        logger.critical("SUPABASE_SERVICE_KEY が設定されていません")
        notify_slack("環境変数エラー", "SUPABASE_SERVICE_KEY が設定されていません")
        sys.exit(1)

    stats = run_daily_check()

    logger.info("バッチ処理終了: %s", stats)

    # エラーサマリーをSlack通知
    errors = stats.get("errors_count", 0)
    if errors > 0:
        error_summary = (
            f"エラー: {errors}件\n"
            f"ユーザー: {stats.get('users_processed', 0)}人処理\n"
            f"スクレイピング: {stats.get('opportunities_scraped', 0)}件\n"
            f"通知: {stats.get('notifications_sent', 0)}件"
        )
        # fatal フェーズのエラーがあればexit(1)
        fatal_errors = [e for e in stats.get("error_details", []) if e.get("phase") == "fatal"]
        if fatal_errors:
            logger.critical("致命的エラーあり: %d件", len(fatal_errors))
            notify_slack("バッチ異常終了", error_summary)
            sys.exit(1)
        else:
            logger.warning("部分エラーあり: %d件（バッチは正常完了）", errors)
            notify_slack("バッチ完了（エラーあり）", error_summary)


if __name__ == "__main__":
    main()
