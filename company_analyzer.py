# 公募ナビ AI - 会社情報分析モジュール
import logging

from gemini_client import call_gemini, parse_json_response
from scraper import extract_text, fetch_page

logger = logging.getLogger(__name__)


def analyze_company(url: str) -> dict:
    """会社のウェブサイトを取得し、Gemini で事業内容を分析する。

    Args:
        url: 会社のウェブサイト URL。

    Returns:
        会社プロフィールの辞書。
    """
    logger.info("会社サイトを取得中: %s", url)
    resp = fetch_page(url)
    text = extract_text(resp.content, include_links=False, base_url=url)

    if not text.strip():
        raise ValueError(f"ページからテキストを取得できませんでした: {url}")

    prompt = f"""以下はある会社のウェブサイトのテキスト内容です。
この会社の事業内容・強み・対応可能な業務を分析し、JSON形式で出力してください。

出力フォーマット:
{{
  "company_name": "会社名（推定）",
  "location": "所在地（推定、不明ならnull）",
  "business_areas": ["事業分野1", "事業分野2"],
  "services": ["提供サービス1", "提供サービス2"],
  "strengths": ["強み・特徴1", "強み・特徴2"],
  "target_industries": ["対象業界1", "対象業界2"],
  "qualifications": ["保有資格・認証（推定、不明なら空配列）"],
  "matching_keywords": ["公募・入札マッチングに使えるキーワード1", "キーワード2"]
}}

情報が不明な項目はnullまたは空配列にしてください。
推定で構いませんので、できるだけ多くの情報を抽出してください。
matching_keywordsには、この会社が受注できそうな行政案件を見つけるための
検索キーワードを10個以上生成してください。

ウェブサイトテキスト:
{text}"""

    logger.info("Gemini APIで会社情報を分析中...")
    response = call_gemini(prompt)
    return parse_json_response(response)
