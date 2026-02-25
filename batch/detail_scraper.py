"""公募ナビAI - 詳細ページスクレイパー

各案件のdetail_urlを巡回し、Geminiで構造化データを抽出する。
抽出項目: published_date, deadline, budget, requirements, detailed_summary, difficulty
"""

import logging
import time

import requests

import config
from gemini_client import call_gemini, parse_json_response
from scraper import fetch_page, extract_text

logger = logging.getLogger(__name__)

# 失敗URLを一時キャッシュ（同一バッチ内で重複fetchを避ける）
_failed_urls: set[str] = set()


def enrich_opportunity(opp: dict) -> dict | None:
    """1件の案件の詳細ページを取得し、構造化データを抽出する。

    Returns:
        抽出結果のdict。取得失敗時はNone。
    """
    detail_url = opp.get("detail_url")
    if not detail_url:
        return None

    if detail_url in _failed_urls:
        return None

    try:
        resp = fetch_page(detail_url)
        text = extract_text(resp.content, include_links=False, base_url=detail_url)

        if not text or len(text.strip()) < 30:
            logger.debug("テキスト不足: %s", detail_url)
            _failed_urls.add(detail_url)
            return None

        result = _extract_details(text, opp)
        return result

    except requests.RequestException as exc:
        logger.debug("詳細ページ取得失敗 %s: %s", detail_url, exc)
        _failed_urls.add(detail_url)
        return None
    except Exception as exc:
        logger.warning("詳細抽出エラー %s: %s", detail_url, exc)
        return None


def enrich_batch(
    opps: list[dict],
    batch_size: int = 10,
    delay: float = 0.5,
) -> list[tuple[str, dict]]:
    """複数案件の詳細を一括取得する。

    Args:
        opps: opportunitiesレコードのリスト（id, detail_url等を含む）
        batch_size: ログ出力の区切り単位
        delay: リクエスト間の待機秒数（サーバー負荷軽減）

    Returns:
        [(opportunity_id, details_dict), ...] のリスト。失敗分は含まない。
    """
    results = []
    total = len(opps)

    for i, opp in enumerate(opps):
        if i > 0 and i % batch_size == 0:
            logger.info("  詳細取得: %d/%d 完了 (%d 成功)", i, total, len(results))

        details = enrich_opportunity(opp)
        if details:
            results.append((opp["id"], details))

        if delay > 0 and i < total - 1:
            time.sleep(delay)

    logger.info("  詳細取得完了: %d/%d 成功", len(results), total)
    return results


def _extract_details(text: str, opp: dict) -> dict | None:
    """Geminiで詳細ページのテキストから構造化データを抽出する。"""
    title = opp.get("title", "")

    # テキストが長すぎる場合は切り詰め（トークン節約）
    if len(text) > 15000:
        text = text[:15000] + "\n...(以下省略)"

    prompt = f"""以下は公募・入札案件の詳細ページのテキストです。
案件名: {title}

このページから以下の情報を抽出してJSON形式で返してください。
見つからない項目はnullとしてください。

{{
  "published_date": "公告日・掲載日（YYYY-MM-DD形式）",
  "deadline": "提出期限・入札期限・締切日（YYYY-MM-DD形式）",
  "budget": "予算・契約金額（例: 1,000万円、500,000円。不明ならnull）",
  "requirements": "参加資格・応募条件（50文字以内で要約）",
  "detailed_summary": "この案件の具体的な業務内容を200文字以内で要約",
  "difficulty": "この案件の参入難易度を判定（高/中/低）。判定基準: 高=特殊資格・大規模実績必須、中=一般的な資格・実績で可、低=資格不要・小規模"
}}

ページテキスト:
{text}"""

    try:
        response = call_gemini(prompt, json_mode=True, max_tokens=1024)
        result = parse_json_response(response)

        if not isinstance(result, dict):
            return None

        # バリデーション: 日付形式チェック
        for date_key in ("published_date", "deadline"):
            val = result.get(date_key)
            if val and (len(str(val)) != 10 or str(val).count("-") != 2):
                result[date_key] = None

        # difficulty は 高/中/低 のみ許可
        if result.get("difficulty") not in ("高", "中", "低"):
            result["difficulty"] = None

        # detailed_summary の長さ制限
        if result.get("detailed_summary") and len(result["detailed_summary"]) > 300:
            result["detailed_summary"] = result["detailed_summary"][:297] + "..."

        return result

    except Exception as exc:
        logger.debug("Gemini抽出失敗: %s", exc)
        return None
