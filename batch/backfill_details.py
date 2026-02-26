"""公募ナビAI - 既存案件の詳細バックフィル（並列版）

detail_fetched_at=NULL の案件を並列でHTTPフェッチ→Gemini抽出→DB保存する。
壊れたURL(p-portal等)は自動スキップ。

Usage:
    python backfill_details.py [--limit 50000] [--workers 15] [--batch 500]
"""

import argparse
import logging
import sys
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

# dotenv を db/config より先にロード
from dotenv import load_dotenv
load_dotenv()

import db
from detail_scraper import enrich_opportunity

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# 統計用（スレッドセーフ）
_lock = threading.Lock()
_stats = {"success": 0, "fail_fetch": 0, "fail_gemini": 0, "fail_db": 0, "skipped": 0}

# 壊れたURLパターン
BAD_URL_PATTERNS = ["/pps-web-biz/UAA01/OAA0101", "/all.html"]


def _is_bad_url(url: str) -> bool:
    return any(p in url for p in BAD_URL_PATTERNS)


def process_one(opp: dict) -> bool:
    """1件を処理: フェッチ→Gemini抽出→DB保存"""
    opp_id = opp["id"]
    detail_url = opp.get("detail_url", "")

    if not detail_url or _is_bad_url(detail_url):
        with _lock:
            _stats["skipped"] += 1
        return False

    try:
        details = enrich_opportunity(opp)
    except Exception:
        with _lock:
            _stats["fail_gemini"] += 1
        return False

    if not details:
        with _lock:
            _stats["fail_fetch"] += 1
        return False

    try:
        db.update_opportunity_details(opp_id, details)
        with _lock:
            _stats["success"] += 1
        return True
    except Exception as exc:
        logger.debug("DB更新失敗 %s: %s", opp_id, exc)
        with _lock:
            _stats["fail_db"] += 1
        return False


def main():
    parser = argparse.ArgumentParser(description="詳細ページバックフィル（並列版）")
    parser.add_argument("--limit", type=int, default=50000, help="処理件数上限")
    parser.add_argument("--workers", type=int, default=15, help="並列ワーカー数")
    parser.add_argument("--batch", type=int, default=1000, help="DB取得バッチサイズ")
    args = parser.parse_args()

    logger.info("=== バックフィル開始 (limit=%d, workers=%d) ===", args.limit, args.workers)
    start_time = time.time()
    total_processed = 0

    while total_processed < args.limit:
        fetch_size = min(args.batch, args.limit - total_processed)
        opps = db.get_unenriched_opportunities(limit=fetch_size)
        if not opps:
            logger.info("対象案件なし。全件処理済みです。")
            break

        batch_num = total_processed // args.batch + 1
        logger.info("バッチ %d: %d件取得 (累計 %d件)", batch_num, len(opps), total_processed)

        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {executor.submit(process_one, opp): opp for opp in opps}
            done_count = 0
            for future in as_completed(futures):
                done_count += 1
                if done_count % 50 == 0:
                    elapsed = time.time() - start_time
                    with _lock:
                        s = _stats.copy()
                    rate = (s["success"] + s["fail_fetch"] + s["fail_gemini"]) / max(elapsed, 1) * 60
                    logger.info(
                        "  進捗 %d/%d | 成功=%d, フェッチ失敗=%d, Gemini失敗=%d, スキップ=%d | %.0f件/分",
                        total_processed + done_count, args.limit,
                        s["success"], s["fail_fetch"], s["fail_gemini"], s["skipped"], rate,
                    )
                try:
                    future.result()
                except Exception as exc:
                    logger.debug("ワーカーエラー: %s", exc)

        total_processed += len(opps)

    elapsed = time.time() - start_time
    logger.info(
        "=== バックフィル完了 (%d分%.0f秒) ===\n"
        "  成功: %d\n"
        "  フェッチ失敗: %d\n"
        "  Gemini失敗: %d\n"
        "  DB失敗: %d\n"
        "  スキップ: %d",
        int(elapsed // 60), elapsed % 60,
        _stats["success"], _stats["fail_fetch"], _stats["fail_gemini"],
        _stats["fail_db"], _stats["skipped"],
    )


if __name__ == "__main__":
    main()
