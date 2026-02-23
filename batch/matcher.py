"""公募ナビAI - マッチングエンジン（バッチ用）"""

import json
import logging

from gemini_client import call_gemini, parse_json_response
import config

logger = logging.getLogger(__name__)


def match_opportunities(
    company_profile: dict,
    opportunities: list[dict],
) -> list[dict]:
    """会社プロフィールと案件リストを照合し、マッチ度を判定する。

    案件数が BATCH_SIZE を超える場合は自動的にバッチ分割して処理する。

    Returns:
        マッチ度スコア付きの案件リスト（スコア降順）。
        各結果に opportunity_id が含まれる。
    """
    if not opportunities:
        return []

    all_results = []

    batches = [
        opportunities[i : i + config.BATCH_SIZE]
        for i in range(0, len(opportunities), config.BATCH_SIZE)
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
    # マッチングに必要な情報だけ抽出してプロンプト短縮
    profile_info = {
        "company_name": company_profile.get("company_name"),
        "business_areas": company_profile.get("business_areas", []),
        "services": company_profile.get("services", []),
        "strengths": company_profile.get("strengths", []),
        "qualifications": company_profile.get("qualifications", []),
        "matching_keywords": company_profile.get("matching_keywords", []),
    }
    company_json = json.dumps(profile_info, ensure_ascii=False, indent=2)

    # 案件情報も必要最小限に
    opp_list = []
    for opp in opportunities:
        opp_list.append({
            "id": opp.get("id"),
            "title": opp.get("title"),
            "organization": opp.get("organization"),
            "category": opp.get("category"),
            "method": opp.get("method"),
            "budget": opp.get("budget"),
            "summary": opp.get("summary"),
            "requirements": opp.get("requirements"),
        })
    opps_json = json.dumps(opp_list, ensure_ascii=False, indent=2)

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
    "id": "案件のid（入力そのまま）",
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

    # opportunity_id に id をマッピング
    for r in results:
        r["opportunity_id"] = r.pop("id", None)

    return results
