"""公募ナビAI - 行政公募・入札情報スクレイピング（バッチ用）

DB駆動: area_sources テーブルからソース一覧を取得してスクレイピング。
HTML スクレイピング + Gemini 抽出と、kkj.go.jp API の2方式に対応。
"""

import logging
from datetime import datetime, timedelta, timezone
from xml.etree import ElementTree

import requests

from gemini_client import call_gemini, parse_json_response
from scraper import extract_text, fetch_page

logger = logging.getLogger(__name__)


def scrape_source(source: dict) -> list[dict]:
    """1つのデータソースをスクレイピングして案件を抽出する。

    notes フィールドが "api:kkj" の場合は kkj.go.jp API を使用し、
    それ以外は従来の HTML スクレイピング + Gemini 抽出を使用する。

    Args:
        source: area_sources テーブルの行。
            {"id": "aichi-pref", "url": "...", "source_name": "...", ...}

    Returns:
        案件情報の辞書リスト。
    """
    notes = source.get("notes", "") or ""
    if notes == "api:kkj" or "kkj.go.jp/api" in source.get("url", ""):
        return _scrape_kkj_api(source)

    return _scrape_html(source)


def _scrape_kkj_api(source: dict) -> list[dict]:
    """kkj.go.jp API を使って案件を取得する（Gemini不要）。"""
    source_name = source.get("source_name", "")
    source_url = source.get("url", "")

    if not source_url:
        logger.warning("URLが空です: %s", source.get("id"))
        return []

    logger.info("API取得中: %s", source_name)

    # 直近7日分のデータを取得
    now = datetime.now(timezone.utc)
    end_date = now.strftime("%Y-%m-%d")
    start_date = (now - timedelta(days=7)).strftime("%Y-%m-%d")

    # URL にすでにパラメータがある場合は追加
    sep = "&" if "?" in source_url else "?"
    full_url = f"{source_url}{sep}Start_Date={start_date}&End_Date={end_date}"

    try:
        resp = requests.get(full_url, timeout=30)
        resp.raise_for_status()
    except requests.RequestException as exc:
        logger.warning("API取得失敗 %s: %s", source_url, exc)
        raise

    opportunities = _parse_kkj_xml(resp.content)
    logger.info("  -> %d件の案件を検出 (API)", len(opportunities))
    return opportunities


def _parse_kkj_xml(xml_bytes: bytes) -> list[dict]:
    """kkj.go.jp API の XML レスポンスをパースして案件リストに変換する。"""
    try:
        root = ElementTree.fromstring(xml_bytes)
    except ElementTree.ParseError as e:
        logger.warning("XML パースエラー: %s", e)
        return []

    results = []
    for sr in root.iter("SearchResult"):
        title = _xml_text(sr, "ProjectName")
        if not title:
            continue

        category_raw = _xml_text(sr, "Category") or ""
        method_raw = _xml_text(sr, "ProcedureType") or ""

        # detail_url: Key から固有URL生成
        key = _xml_text(sr, "Key")
        if key:
            detail_url = f"https://www.kkj.go.jp/d/?A={key}&L=ja"
        else:
            detail_url = _xml_text(sr, "ExternalDocumentURI")

        # summary: ProjectDescription から余分なメタデータを除去
        summary_raw = _xml_text(sr, "ProjectDescription") or ""
        summary = _clean_summary(summary_raw, title)

        item = {
            "title": title,
            "organization": _xml_text(sr, "OrganizationName"),
            "category": _map_category(category_raw),
            "method": _map_method(method_raw),
            "deadline": None,
            "budget": None,
            "summary": summary,
            "detail_url": detail_url,
            "requirements": _xml_text(sr, "Certification"),
        }
        results.append(item)

    return results


def _xml_text(element, tag: str):
    """XMLタグのテキストを安全に取得する。"""
    child = element.find(tag)
    if child is not None and child.text:
        return child.text.strip()
    return None


def _map_category(raw: str) -> str:
    """kkj.go.jp の Category を koubo-navi の category にマッピング。"""
    mapping = {"物品": "物品", "工事": "建設", "役務": "サービス"}
    return mapping.get(raw, raw or "その他")


def _map_method(raw: str) -> str:
    """ProcedureType を入札方式にマッピング。"""
    if not raw:
        return "不明"
    if "一般競争" in raw:
        return "一般競争入札"
    if "指名" in raw:
        return "指名競争入札"
    if "随意" in raw:
        return "随意契約"
    if "公募" in raw or "プロポーザル" in raw or "企画" in raw:
        return "公募型プロポーザル"
    return raw


def _clean_summary(raw: str, title: str) -> str | None:
    """ProjectDescription から余分なメタデータを除去し、要約を作成する。"""
    if not raw:
        return None
    text = raw
    if text.startswith(title):
        text = text[len(title):].strip()
    lines = []
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        if line.startswith("調達案件番号") or line.startswith("調達種別"):
            continue
        lines.append(line)
    clean = " ".join(lines)
    if len(clean) > 200:
        clean = clean[:197] + "..."
    return clean if clean else None


def _scrape_html(source: dict) -> list[dict]:
    """従来の HTML スクレイピング + Gemini 抽出。"""
    source_name = source.get("source_name", "")
    source_url = source.get("url", "")

    if not source_url:
        logger.warning("URLが空です: %s", source.get("id"))
        return []

    logger.info("取得中: %s (%s)", source_name, source_url)
    try:
        resp = fetch_page(source_url)
        text = extract_text(
            resp.content,
            include_links=True,
            base_url=source_url,
        )

        if not text.strip():
            logger.warning("テキスト取得できず: %s", source_name)
            return []

        opportunities = _extract_opportunities(text, source_name, source_url)
        logger.info("  -> %d件の案件を検出", len(opportunities))
        return opportunities

    except requests.RequestException as exc:
        logger.warning("ページ取得失敗 %s: %s", source_url, exc)
        raise
    except Exception as exc:
        logger.warning("案件抽出エラー %s: %s", source_name, exc)
        raise


def _extract_opportunities(
    text: str,
    source_name: str,
    source_url: str,
) -> list[dict]:
    """Gemini を使ってページテキストから公募・入札案件を抽出する。"""
    prompt = f"""以下は「{source_name}」のウェブページのテキスト内容です。
このページから公募・入札・調達・業務委託・プロポーザルに関する案件情報を
全て抽出してください。

案件が見つからない場合は空の配列 [] を返してください。
ナビゲーションメニュー、フッター、サイドバーなどの案件以外の情報は無視してください。

出力フォーマット（JSON配列）:
[
  {{
    "title": "案件名",
    "organization": "発注機関名",
    "category": "カテゴリ（IT/建設/物品/サービス/コンサル/清掃/警備/印刷/イベント/その他）",
    "deadline": "締切日（YYYY-MM-DD形式、不明ならnull）",
    "budget": "予算（円単位の数値または文字列、不明ならnull）",
    "summary": "概要（100文字以内）",
    "detail_url": "詳細ページのURL（相対URLの場合は「{source_url}」を基に絶対URLに変換。不明ならnull）",
    "requirements": "参加資格・条件（あれば。なければnull）",
    "method": "入札方式（一般競争入札/指名競争入札/随意契約/公募型プロポーザル/企画競争/不明）"
  }}
]

ウェブページテキスト:
{text}"""

    response = call_gemini(prompt)
    opportunities = parse_json_response(response)

    if not isinstance(opportunities, list):
        return []

    return opportunities
