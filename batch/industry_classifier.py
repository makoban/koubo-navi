"""公募ナビAI - 既存案件の業種カテゴリ一括分類

既存の industry_category=NULL 案件を対象に、
title + summary + category だけで10カテゴリに分類する。
50件ずつバッチでGeminiに送信し、DB更新する。

Usage:
    python industry_classifier.py [--limit 50000] [--batch-size 50] [--delay 0.3]
"""

import argparse
import json
import logging
import sys

import db
from gemini_client import call_gemini, parse_json_response

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

VALID_CATEGORIES = (
    "IT・DX", "建設・土木", "コンサル・調査", "広告・クリエイティブ",
    "設備・物品", "清掃・管理", "医療・福祉", "教育・研修",
    "環境・エネルギー", "その他",
)

CATEGORIES_STR = " / ".join(VALID_CATEGORIES)


def get_unclassified_opportunities(limit: int = 50000) -> list[dict]:
    """industry_category が NULL の案件を取得する。"""
    import requests
    resp = requests.get(
        db._url(
            "/opportunities?industry_category=is.null"
            "&select=id,title,summary,category"
            f"&order=scraped_at.desc&limit={limit}"
        ),
        headers=db._headers(),
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


def classify_batch(opps: list[dict]) -> dict[str, str]:
    """50件分の案件をGeminiで一括分類する。

    Returns:
        {opportunity_id: category} のdict
    """
    opp_lines = []
    for i, opp in enumerate(opps, 1):
        title = opp.get("title", "不明")
        summary = (opp.get("summary") or "")[:100]
        category = opp.get("category") or ""
        opp_lines.append(f"{i}. タイトル: {title} / 分類: {category} / 要約: {summary}")

    opp_text = "\n".join(opp_lines)

    prompt = f"""以下は公募・入札案件のリストです。
各案件を以下の10カテゴリのいずれか1つに分類してください。

カテゴリ: {CATEGORIES_STR}

案件リスト:
{opp_text}

各案件の番号と分類結果をJSON配列で出力してください:
[
  {{"index": 1, "category": "カテゴリ名"}},
  {{"index": 2, "category": "カテゴリ名"}}
]

全{len(opps)}件を出力してください。"""

    try:
        response = call_gemini(prompt, json_mode=True, max_tokens=4096)
        results = parse_json_response(response)

        if not isinstance(results, list):
            return {}

        mapping = {}
        for r in results:
            idx = r.get("index", 0) - 1
            cat = r.get("category", "その他")
            if 0 <= idx < len(opps):
                if cat not in VALID_CATEGORIES:
                    cat = "その他"
                mapping[opps[idx]["id"]] = cat

        return mapping

    except Exception as exc:
        logger.warning("分類バッチ失敗: %s", exc)
        return {}


def main():
    parser = argparse.ArgumentParser(description="業種カテゴリ一括分類")
    parser.add_argument("--limit", type=int, default=50000, help="処理件数上限")
    parser.add_argument("--batch-size", type=int, default=50, help="1バッチの件数")
    parser.add_argument("--delay", type=float, default=0.3, help="バッチ間の待機秒数")
    args = parser.parse_args()

    logger.info("=== 業種カテゴリ分類 開始 (limit=%d, batch=%d) ===", args.limit, args.batch_size)

    opps = get_unclassified_opportunities(limit=args.limit)
    total = len(opps)
    if not opps:
        logger.info("対象案件なし。全件分類済みです。")
        return

    logger.info("対象案件: %d件 (%d バッチ)", total, (total + args.batch_size - 1) // args.batch_size)

    import time
    success = 0
    batches = [opps[i:i + args.batch_size] for i in range(0, total, args.batch_size)]

    for batch_idx, batch in enumerate(batches, 1):
        logger.info("バッチ %d/%d (%d件)...", batch_idx, len(batches), len(batch))

        mapping = classify_batch(batch)
        for opp_id, category in mapping.items():
            try:
                db.update_industry_category(opp_id, category)
                success += 1
            except Exception as exc:
                logger.debug("更新失敗 %s: %s", opp_id, exc)

        if batch_idx < len(batches) and args.delay > 0:
            time.sleep(args.delay)

        if batch_idx % 10 == 0:
            logger.info("  進捗: %d/%d 成功", success, batch_idx * args.batch_size)

    logger.info("=== 分類完了: %d/%d 成功 ===", success, total)

    remaining = get_unclassified_opportunities(limit=1)
    if remaining:
        logger.info("残件あり。再実行してください。")
    else:
        logger.info("全件分類完了!")


if __name__ == "__main__":
    main()
