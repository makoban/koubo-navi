"""公募ナビAI - 一括データ再投入スクリプト

全47都道府県のKKJ API案件をCount=1000で取得し、
Supabase一括POST（バッチ500件ずつ）で高速に保存する。

使い方:
  cd batch
  pip install requests
  SUPABASE_SERVICE_KEY=sb_secret_... python bulk_reload.py
"""

import logging
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from xml.etree import ElementTree

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://ypyrjsdotkeyvzequdez.supabase.co")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
KKJ_API = "https://www.kkj.go.jp/api/"

PREFECTURES = [
    ("01", "hokkaido", "北海道"), ("02", "aomori", "青森県"), ("03", "iwate", "岩手県"),
    ("04", "miyagi", "宮城県"), ("05", "akita", "秋田県"), ("06", "yamagata", "山形県"),
    ("07", "fukushima", "福島県"), ("08", "ibaraki", "茨城県"), ("09", "tochigi", "栃木県"),
    ("10", "gunma", "群馬県"), ("11", "saitama", "埼玉県"), ("12", "chiba", "千葉県"),
    ("13", "tokyo", "東京都"), ("14", "kanagawa", "神奈川県"), ("15", "niigata", "新潟県"),
    ("16", "toyama", "富山県"), ("17", "ishikawa", "石川県"), ("18", "fukui", "福井県"),
    ("19", "yamanashi", "山梨県"), ("20", "nagano", "長野県"), ("21", "gifu", "岐阜県"),
    ("22", "shizuoka", "静岡県"), ("23", "aichi", "愛知県"), ("24", "mie", "三重県"),
    ("25", "shiga", "滋賀県"), ("26", "kyoto", "京都府"), ("27", "osaka", "大阪府"),
    ("28", "hyogo", "兵庫県"), ("29", "nara", "奈良県"), ("30", "wakayama", "和歌山県"),
    ("31", "tottori", "鳥取県"), ("32", "shimane", "島根県"), ("33", "okayama", "岡山県"),
    ("34", "hiroshima", "広島県"), ("35", "yamaguchi", "山口県"), ("36", "tokushima", "徳島県"),
    ("37", "kagawa", "香川県"), ("38", "ehime", "愛媛県"), ("39", "kochi", "高知県"),
    ("40", "fukuoka", "福岡県"), ("41", "saga", "佐賀県"), ("42", "nagasaki", "長崎県"),
    ("43", "kumamoto", "熊本県"), ("44", "oita", "大分県"), ("45", "miyazaki", "宮崎県"),
    ("46", "kagoshima", "鹿児島県"), ("47", "okinawa", "沖縄県"),
]


def _sb_headers():
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates,return=minimal",
    }


def _xml_text(element, tag):
    child = element.find(tag)
    if child is not None and child.text:
        return child.text.strip()
    return None


def _extract_deadline(sr):
    for tag in ("SubmissionDeadline", "DeadlineDate", "TenderSubmissionDeadline",
                "ClosingDate", "ResponseDeadline", "EndDate"):
        raw = _xml_text(sr, tag)
        if raw:
            return raw[:10]

    desc = _xml_text(sr, "ProjectDescription") or ""
    # ISO日付をバリデーション付きで抽出（電話番号 0538-66-11 等を除外）
    for date_match in re.finditer(r"(\d{4})-(\d{2})-(\d{2})", desc):
        y, m, d = int(date_match.group(1)), int(date_match.group(2)), int(date_match.group(3))
        if 2020 <= y <= 2030 and 1 <= m <= 12 and 1 <= d <= 31:
            return date_match.group(0)

    # 和暦パターン
    patterns = [
        r"提出期限[^\d]*(\d{2})年(\d{1,2})月(\d{1,2})日",
        r"入札期限[^\d]*(\d{2})年(\d{1,2})月(\d{1,2})日",
        r"公開終了日[^\d]*(\d{2})年(\d{1,2})月(\d{1,2})日",
        r"締[切め]日?[^\d]*(\d{2})年(\d{1,2})月(\d{1,2})日",
    ]
    for pat in patterns:
        m = re.search(pat, desc)
        if m:
            try:
                year = 2018 + int(m.group(1))
                month = int(m.group(2))
                day = int(m.group(3))
                iso = f"{year:04d}-{month:02d}-{day:02d}"
                dt = datetime.strptime(iso, "%Y-%m-%d")
                now = datetime.now()
                if (now - timedelta(days=365)) <= dt <= (now + timedelta(days=180)):
                    return iso
            except (ValueError, TypeError):
                pass

    return None


def _clean_summary(raw, title):
    if not raw:
        return None
    parts = []
    item_cat = re.search(r"調達品目分類(.+?)(?:公告内容|調達機関|$)", raw)
    if item_cat:
        cat_text = item_cat.group(1).strip()
        if cat_text and cat_text != title:
            parts.append(cat_text)
    content = re.search(r"公告内容(.+)", raw, re.DOTALL)
    if content:
        ct = content.group(1).strip()
        ct = re.sub(r"公\s*示\s*第\s*\d+\s*号\s*", "", ct)
        ct = re.sub(r"入\s*札\s*公\s*告\s*", "", ct)
        ct = ct.strip()
        if ct:
            ct = ct[:120].strip()
            if len(ct) > 3:
                parts.append(ct)
    if not parts:
        text = raw
        if text.startswith(title):
            text = text[len(title):].strip()
        for prefix in ("調達案件番号", "調達種別", "分類", "調達案件名称",
                        "公開開始日", "公開終了日", "調達機関", "調達機関所在地"):
            text = re.sub(rf"{prefix}[^\n]*", "", text)
        text = re.sub(r"令和\d{2}年\d{1,2}月\d{1,2}日", "", text)
        text = " ".join(text.split()).strip()
        if text:
            parts.append(text[:120])
    summary = "。".join(parts)
    if len(summary) > 200:
        summary = summary[:197] + "..."
    return summary if summary else None


def _map_category(raw):
    mapping = {"物品": "物品", "工事": "建設", "役務": "サービス"}
    return mapping.get(raw, raw or "その他")


def _map_method(raw):
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


def fetch_kkj(lg_code):
    """KKJ APIからCount=1000で案件を取得する。"""
    now = datetime.now(timezone.utc)
    end_date = now.strftime("%Y-%m-%d")
    start_date = (now - timedelta(days=30)).strftime("%Y-%m-%d")

    params = {
        "LG_Code": lg_code,
        "Start_Date": start_date,
        "End_Date": end_date,
        "Count": "1000",
    }
    resp = requests.get(KKJ_API, params=params, timeout=60)
    resp.raise_for_status()

    root = ElementTree.fromstring(resp.content)
    results = []
    seen_titles = set()

    for sr in root.iter("SearchResult"):
        title = _xml_text(sr, "ProjectName")
        if not title:
            continue
        # 重複除外
        if title in seen_titles:
            continue
        seen_titles.add(title)

        detail_url = _xml_text(sr, "ExternalDocumentURI")
        if not detail_url:
            key = _xml_text(sr, "Key")
            if key:
                detail_url = f"https://www.kkj.go.jp/d/?A={key}&L=ja"

        summary_raw = _xml_text(sr, "ProjectDescription") or ""
        results.append({
            "title": title[:500],
            "organization": _xml_text(sr, "OrganizationName"),
            "category": _map_category(_xml_text(sr, "Category") or ""),
            "method": _map_method(_xml_text(sr, "ProcedureType") or ""),
            "deadline": _extract_deadline(sr),
            "budget": None,
            "summary": _clean_summary(summary_raw, title),
            "detail_url": detail_url,
            "requirements": _xml_text(sr, "Certification"),
        })

    return results


def bulk_upsert(records):
    """Supabase REST APIで一括upsert（500件ずつバッチ）。"""
    total = 0
    batch_size = 500
    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        try:
            resp = requests.post(
                f"{SUPABASE_URL}/rest/v1/opportunities",
                headers=_sb_headers(),
                json=batch,
                timeout=30,
            )
            if resp.ok:
                total += len(batch)
            else:
                logger.warning("  bulk upsert error (batch %d): %s %s",
                               i // batch_size, resp.status_code, resp.text[:200])
        except Exception as e:
            logger.warning("  bulk upsert exception (batch %d): %s", i // batch_size, e)
    return total


def main():
    if not SUPABASE_SERVICE_KEY:
        logger.error("SUPABASE_SERVICE_KEY is not set")
        sys.exit(1)

    logger.info("=" * 60)
    logger.info("公募ナビAI - 一括データ再投入 (Count=1000)")
    logger.info("=" * 60)

    grand_total = 0
    errors = 0

    for lg_code, area_id, area_name in PREFECTURES:
        source_id = f"kkj-{area_id}"
        try:
            opps = fetch_kkj(lg_code)
            if not opps:
                logger.info("  %s: 0件", area_name)
                continue

            # area_id と source_id を付与
            records = []
            for opp in opps:
                records.append({
                    "area_id": area_id,
                    "source_id": source_id,
                    **opp,
                })

            saved = bulk_upsert(records)
            grand_total += saved
            logger.info("  %s: API=%d件, DB保存=%d件", area_name, len(opps), saved)

            time.sleep(0.5)

        except Exception as e:
            errors += 1
            logger.warning("  %s: エラー %s", area_name, e)
            time.sleep(1)

    logger.info("=" * 60)
    logger.info("完了: 合計 %d件保存, %d件エラー", grand_total, errors)
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
