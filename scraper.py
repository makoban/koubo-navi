# 公募ナビ AI - Web スクレイピングユーティリティ
import logging
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

import config

logger = logging.getLogger(__name__)


def fetch_page(url: str) -> requests.Response:
    """Web ページを取得する。"""
    headers = {"User-Agent": config.USER_AGENT}
    resp = requests.get(
        url,
        headers=headers,
        timeout=config.REQUEST_TIMEOUT,
        allow_redirects=True,
    )
    resp.raise_for_status()
    return resp


def extract_text(
    html_content: bytes,
    include_links: bool = False,
    base_url: str = "",
) -> str:
    """HTML からテキストを抽出する。

    Args:
        html_content: 生の HTML バイト列。
        include_links: True の場合、ページ内リンクも末尾に追加。
        base_url: 相対URLを絶対URLに変換するための基底URL。

    Returns:
        抽出されたテキスト（MAX_TEXT_LENGTH で切り詰め）。
    """
    soup = BeautifulSoup(html_content, "html.parser")

    # ノイズになるタグを除去
    for tag in soup(["script", "style", "noscript", "iframe"]):
        tag.decompose()

    text = soup.get_text(separator="\n", strip=True)

    if include_links:
        links = []
        for a in soup.find_all("a", href=True):
            href = a["href"]
            link_text = a.get_text(strip=True)
            if not link_text or len(link_text) < 3:
                continue
            # 相対 URL → 絶対 URL
            if base_url and not href.startswith(("http://", "https://")):
                href = urljoin(base_url, href)
            links.append(f"[{link_text}]({href})")

        if links:
            text += "\n\n--- ページ内リンク ---\n"
            text += "\n".join(links[:200])

    if len(text) > config.MAX_TEXT_LENGTH:
        text = text[: config.MAX_TEXT_LENGTH] + "\n...(以下省略)"

    return text
