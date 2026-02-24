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

    # 致命的エラーの場合のみ exit code 1（個別ソース失敗は許容）
    errors = stats.get("errors_count", 0)
    if errors > 0:
        # fatal フェーズのエラーがあればexit(1)
        fatal_errors = [e for e in stats.get("error_details", []) if e.get("phase") == "fatal"]
        if fatal_errors:
            logger.critical("致命的エラーあり: %d件", len(fatal_errors))
            sys.exit(1)
        else:
            logger.warning("部分エラーあり: %d件（バッチは正常完了）", errors)


if __name__ == "__main__":
    main()
