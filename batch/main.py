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
        sys.exit(1)

    if not config.SUPABASE_SERVICE_KEY:
        logger.critical("SUPABASE_SERVICE_KEY が設定されていません")
        sys.exit(1)

    stats = run_daily_check()

    logger.info("バッチ処理終了: %s", stats)

    # エラーがあった場合は exit code 1（Render.com でアラート）
    if stats.get("errors_count", 0) > 0:
        logger.warning("エラーあり: %d件", stats["errors_count"])
        sys.exit(1)


if __name__ == "__main__":
    main()
