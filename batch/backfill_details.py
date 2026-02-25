"""公募ナビAI - 既存案件の詳細バックフィル

既存の detail_fetched_at=NULL 案件を対象に詳細ページを取得し、
Geminiで構造化データを抽出してDBに保存する。

Usage:
    python backfill_details.py [--limit 500] [--delay 0.5]
"""

import argparse
import logging
import sys

import db
from detail_scraper import enrich_batch

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(description="詳細ページバックフィル")
    parser.add_argument("--limit", type=int, default=500, help="1回あたりの処理件数")
    parser.add_argument("--delay", type=float, default=0.5, help="リクエスト間の待機秒数")
    args = parser.parse_args()

    logger.info("=== バックフィル開始 (limit=%d, delay=%.1f) ===", args.limit, args.delay)

    opps = db.get_unenriched_opportunities(limit=args.limit)
    if not opps:
        logger.info("対象案件なし。全件取得済みです。")
        return

    logger.info("対象案件: %d件", len(opps))

    results = enrich_batch(opps, batch_size=10, delay=args.delay)

    success = 0
    for opp_id, details in results:
        try:
            db.update_opportunity_details(opp_id, details)
            success += 1
        except Exception as exc:
            logger.debug("DB更新失敗 %s: %s", opp_id, exc)

    logger.info("=== バックフィル完了: %d/%d 成功 ===", success, len(opps))

    # 残件数を確認
    remaining = db.get_unenriched_opportunities(limit=1)
    if remaining:
        logger.info("残件あり。再実行してください。")
    else:
        logger.info("全件処理完了!")


if __name__ == "__main__":
    main()
