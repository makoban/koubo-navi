# 公募ナビ AI - 行政公募・入札情報スクレイピング
import logging

import requests

import config
from gemini_client import call_gemini, parse_json_response
from scraper import extract_text, fetch_page

logger = logging.getLogger(__name__)


def scrape_area(area_key: str) -> list[dict]:
    """指定エリアの全行政データソースをスクレイピングして案件を抽出する。

    Args:
        area_key: config.AREAS のキー（例: "aichi"）。

    Returns:
        案件情報の辞書リスト。
    """
    area = config.AREAS.get(area_key)
    if not area:
        raise ValueError(f"未対応のエリア: {area_key}")

    all_opportunities = []

    for source in area["sources"]:
        logger.info("取得中: %s (%s)", source["name"], source["url"])
        try:
            resp = fetch_page(source["url"])
            text = extract_text(
                resp.content,
                include_links=True,
                base_url=source["url"],
            )

            if not text.strip():
                logger.warning("テキスト取得できず: %s", source["name"])
                continue

            opportunities = _extract_opportunities(
                text, source["name"], source["url"],
            )
            all_opportunities.extend(opportunities)
            logger.info("  -> %d件の案件を検出", len(opportunities))

        except requests.RequestException as exc:
            logger.warning("ページ取得失敗 %s: %s", source["url"], exc)
        except Exception as exc:
            logger.warning("案件抽出エラー %s: %s", source["name"], exc)

    return all_opportunities


def scrape_custom_url(url: str, source_name: str = "") -> list[dict]:
    """任意の URL を1つスクレイピングして案件を抽出する。

    Args:
        url: スクレイピング対象 URL。
        source_name: データソース名（表示用）。

    Returns:
        案件情報の辞書リスト。
    """
    if not source_name:
        source_name = url

    resp = fetch_page(url)
    text = extract_text(resp.content, include_links=True, base_url=url)

    if not text.strip():
        return []

    return _extract_opportunities(text, source_name, url)


def _extract_opportunities(
    text: str,
    source_name: str,
    source_url: str,
) -> list[dict]:
    """Gemini を使ってページテキストから公募・入札案件を抽出する。

    「雑読み」アプローチ: HTML テキストをそのまま Gemini に渡し、
    AI に案件情報を構造化データとして抽出させる。
    """
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

    # 各案件にデータソース情報を付加
    for opp in opportunities:
        opp["source"] = source_name

    return opportunities
