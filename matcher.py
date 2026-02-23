# 公募ナビ AI - マッチングエンジン
import json
import logging

from gemini_client import call_gemini, parse_json_response

logger = logging.getLogger(__name__)

# 1回の API 呼び出しで処理する案件数の上限。
# 案件が多すぎると JSON 出力が途中で切れるため、バッチ分割する。
BATCH_SIZE = 15


def match_opportunities(
    company_profile: dict,
    opportunities: list[dict],
) -> list[dict]:
    """会社プロフィールと案件リストを照合し、マッチ度を判定する。

    案件数が BATCH_SIZE を超える場合は自動的にバッチ分割して処理する。

    Args:
        company_profile: analyze_company() の出力。
        opportunities: scrape_area() の出力。

    Returns:
        マッチ度スコア付きの案件リスト（スコア降順）。
    """
    if not opportunities:
        return []

    all_results = []

    # バッチ分割
    batches = [
        opportunities[i : i + BATCH_SIZE]
        for i in range(0, len(opportunities), BATCH_SIZE)
    ]
    total_batches = len(batches)

    for batch_idx, batch in enumerate(batches, 1):
        if total_batches > 1:
            logger.info(
                "  マッチング バッチ %d/%d (%d件)...",
                batch_idx, total_batches, len(batch),
            )
        try:
            results = _match_batch(company_profile, batch)
            all_results.extend(results)
        except Exception as exc:
            logger.warning("バッチ %d マッチング失敗: %s", batch_idx, exc)

    all_results.sort(key=lambda x: x.get("match_score", 0), reverse=True)
    return all_results


def _match_batch(
    company_profile: dict,
    opportunities: list[dict],
) -> list[dict]:
    """1バッチ分の案件をマッチングする。"""
    company_json = json.dumps(company_profile, ensure_ascii=False, indent=2)
    opps_json = json.dumps(opportunities, ensure_ascii=False, indent=2)

    prompt = f"""あなたは公募・入札案件のマッチングAIアドバイザーです。
以下の「会社プロフィール」と「公募・入札案件リスト」を照合し、
各案件について、この会社がどの程度マッチするかを判定してください。

## 会社プロフィール
{company_json}

## 案件リスト
{opps_json}

## 出力フォーマット（JSON配列、match_score が高い順にソート）
[
  {{
    "title": "案件名",
    "organization": "発注機関名",
    "category": "カテゴリ",
    "deadline": "締切日",
    "budget": "予算",
    "detail_url": "詳細URL",
    "source": "情報源",
    "method": "入札方式",
    "match_score": 85,
    "match_reason": "マッチする理由（50文字以内）",
    "risk_notes": "注意点（なければnull）",
    "recommendation": "強く推奨/推奨/検討可/非推奨",
    "action_items": ["仕様書を確認", "実績証明書を準備"]
  }}
]

## 判定基準
- 80-100: 事業内容と非常によく合致
- 60-79:  関連性あり、対応可能
- 40-59:  部分的に関連
- 0-39:   関連性が低い

全案件を判定し、match_score 高い順に出力してください。"""

    response = call_gemini(prompt, max_tokens=16384)
    results = parse_json_response(response)

    if not isinstance(results, list):
        return []

    return results
