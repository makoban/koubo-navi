"""公募ナビAI - 既存DB案件に対するマッチング実行スクリプト

DB内のopportunitiesテーブルから案件を取得し、
指定ユーザーに対してGemini AIマッチングを実行する。

使い方:
  cd batch
  pip install requests
  python run_matching.py
"""

import json
import logging
import os
import sys
import time

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://ypyrjsdotkeyvzequdez.supabase.co")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-2.0-flash"
BATCH_SIZE = 15  # Gemini 1回あたりの案件数


def _sb_headers():
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
    }


def sb_get(path):
    resp = requests.get(f"{SUPABASE_URL}/rest/v1{path}", headers=_sb_headers(), timeout=30)
    resp.raise_for_status()
    return resp.json()


def sb_post(path, data, extra_headers=None):
    headers = _sb_headers()
    if extra_headers:
        headers.update(extra_headers)
    resp = requests.post(f"{SUPABASE_URL}/rest/v1{path}", headers=headers, json=data, timeout=30)
    return resp


def call_gemini(prompt):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "maxOutputTokens": 16384,
        },
    }
    resp = requests.post(url, json=body, timeout=120)
    resp.raise_for_status()
    data = resp.json()
    text = data["candidates"][0]["content"]["parts"][0]["text"]
    return json.loads(text)


def match_batch(profile, opportunities):
    profile_info = {
        "company_name": profile.get("company_name"),
        "business_areas": profile.get("business_areas", []),
        "services": profile.get("services", []),
        "strengths": profile.get("strengths", []),
        "qualifications": profile.get("qualifications", []),
        "matching_keywords": profile.get("matching_keywords", []),
    }
    company_json = json.dumps(profile_info, ensure_ascii=False, indent=2)

    opp_list = []
    for opp in opportunities:
        opp_list.append({
            "id": opp.get("id"),
            "title": opp.get("title"),
            "organization": opp.get("organization"),
            "category": opp.get("category"),
            "method": opp.get("method"),
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
    "recommendation": "強く推奨/推奨/検討可/非推奨"
  }}
]

## 判定基準
- 80-100: 事業内容と非常によく合致
- 60-79:  関連性あり、対応可能
- 40-59:  部分的に関連
- 0-39:   関連性が低い

全案件を判定し、match_score 高い順に出力してください。"""

    results = call_gemini(prompt)
    if isinstance(results, list):
        return results
    return []


def main():
    if not GEMINI_API_KEY:
        # Render.comの環境変数から取得を試みる
        logger.error("GEMINI_API_KEY が未設定です。環境変数で指定してください。")
        sys.exit(1)

    USER_ID = "c73b4a8a-390a-4f5e-92f0-478ad1143d47"

    logger.info("=" * 60)
    logger.info("公募ナビAI - マッチング実行")
    logger.info("=" * 60)

    # 1. ユーザーのプロフィール取得
    profiles = sb_get(f"/company_profiles?user_id=eq.{USER_ID}&select=*")
    if not profiles:
        logger.error("プロフィールが見つかりません")
        sys.exit(1)
    profile = profiles[0]
    logger.info("プロフィール: %s", profile.get("company_name"))

    # 2. ユーザーのエリア取得
    areas = sb_get(f"/user_areas?user_id=eq.{USER_ID}&active=eq.true&select=area_id")
    area_ids = [a["area_id"] for a in areas]
    logger.info("エリア: %s", area_ids)

    # 3. エリアの案件を取得（最新300件）
    area_filter = ",".join(area_ids)
    opps = sb_get(f"/opportunities?area_id=in.({area_filter})&select=*&order=scraped_at.desc&limit=300")
    logger.info("案件数: %d件", len(opps))

    if not opps:
        logger.info("対象案件なし")
        return

    # 4. バッチでマッチング実行
    all_results = []
    batches = [opps[i:i + BATCH_SIZE] for i in range(0, len(opps), BATCH_SIZE)]
    logger.info("バッチ数: %d", len(batches))

    for idx, batch in enumerate(batches, 1):
        logger.info("  バッチ %d/%d (%d件)...", idx, len(batches), len(batch))
        try:
            results = match_batch(profile, batch)
            all_results.extend(results)
            logger.info("    -> %d件マッチ", len(results))
            time.sleep(1)  # API rate limit
        except Exception as e:
            logger.warning("    バッチ %d 失敗: %s", idx, e)
            time.sleep(2)

    logger.info("マッチング完了: 合計 %d件", len(all_results))

    # 5. スコア順にソート
    all_results.sort(key=lambda x: x.get("match_score", 0), reverse=True)

    # 6. user_opportunities に保存
    saved = 0
    for rank, r in enumerate(all_results, 1):
        opp_id = r.get("id")
        if not opp_id:
            continue
        record = {
            "user_id": USER_ID,
            "opportunity_id": opp_id,
            "match_score": r.get("match_score", 0),
            "match_reason": r.get("match_reason"),
            "recommendation": r.get("recommendation"),
            "rank_position": rank,
            "is_dismissed": False,
        }
        resp = sb_post(
            "/user_opportunities",
            record,
            extra_headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        )
        if resp.ok:
            saved += 1
        else:
            logger.warning("  保存失敗 opp=%s: %s", opp_id, resp.text[:100])

    logger.info("=" * 60)
    logger.info("完了: %d件中 %d件保存", len(all_results), saved)

    # 上位10件を表示
    logger.info("--- 上位10件 ---")
    for r in all_results[:10]:
        logger.info("  [%d%%] %s - %s", r.get("match_score", 0), r.get("id", "")[:8], r.get("match_reason", ""))
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
