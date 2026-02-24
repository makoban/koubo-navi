"""公募ナビAI - 全47都道府県 初期データ投入スクリプト

官公需情報ポータルサイト API (kkj.go.jp) を使って
全47都道府県の直近30日分の公募・入札情報を取得し、Supabase DBに保存する。

使い方:
  cd batch
  pip install requests python-dotenv
  # 環境変数を設定 (.env ファイルまたは export)
  #   SUPABASE_SERVICE_KEY=sb_secret_...
  #   SUPABASE_URL=https://ypyrjsdotkeyvzequdez.supabase.co  (デフォルト)
  python initial_load.py
"""

import logging
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from xml.etree import ElementTree

import requests

# 同ディレクトリの db.py をインポート
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from db import upsert_opportunities

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ── Supabase 接続 ──
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://ypyrjsdotkeyvzequdez.supabase.co")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# ── kkj.go.jp API ──
KKJ_API = "https://www.kkj.go.jp/api/"

# ── 全47都道府県マスタ ──
PREFECTURES = [
    {"lg_code": "01", "area_id": "hokkaido",  "area_name": "北海道"},
    {"lg_code": "02", "area_id": "aomori",    "area_name": "青森県"},
    {"lg_code": "03", "area_id": "iwate",     "area_name": "岩手県"},
    {"lg_code": "04", "area_id": "miyagi",    "area_name": "宮城県"},
    {"lg_code": "05", "area_id": "akita",     "area_name": "秋田県"},
    {"lg_code": "06", "area_id": "yamagata",  "area_name": "山形県"},
    {"lg_code": "07", "area_id": "fukushima", "area_name": "福島県"},
    {"lg_code": "08", "area_id": "ibaraki",   "area_name": "茨城県"},
    {"lg_code": "09", "area_id": "tochigi",   "area_name": "栃木県"},
    {"lg_code": "10", "area_id": "gunma",     "area_name": "群馬県"},
    {"lg_code": "11", "area_id": "saitama",   "area_name": "埼玉県"},
    {"lg_code": "12", "area_id": "chiba",     "area_name": "千葉県"},
    {"lg_code": "13", "area_id": "tokyo",     "area_name": "東京都"},
    {"lg_code": "14", "area_id": "kanagawa",  "area_name": "神奈川県"},
    {"lg_code": "15", "area_id": "niigata",   "area_name": "新潟県"},
    {"lg_code": "16", "area_id": "toyama",    "area_name": "富山県"},
    {"lg_code": "17", "area_id": "ishikawa",  "area_name": "石川県"},
    {"lg_code": "18", "area_id": "fukui",     "area_name": "福井県"},
    {"lg_code": "19", "area_id": "yamanashi", "area_name": "山梨県"},
    {"lg_code": "20", "area_id": "nagano",    "area_name": "長野県"},
    {"lg_code": "21", "area_id": "gifu",      "area_name": "岐阜県"},
    {"lg_code": "22", "area_id": "shizuoka",  "area_name": "静岡県"},
    {"lg_code": "23", "area_id": "aichi",     "area_name": "愛知県"},
    {"lg_code": "24", "area_id": "mie",       "area_name": "三重県"},
    {"lg_code": "25", "area_id": "shiga",     "area_name": "滋賀県"},
    {"lg_code": "26", "area_id": "kyoto",     "area_name": "京都府"},
    {"lg_code": "27", "area_id": "osaka",     "area_name": "大阪府"},
    {"lg_code": "28", "area_id": "hyogo",     "area_name": "兵庫県"},
    {"lg_code": "29", "area_id": "nara",      "area_name": "奈良県"},
    {"lg_code": "30", "area_id": "wakayama",  "area_name": "和歌山県"},
    {"lg_code": "31", "area_id": "tottori",   "area_name": "鳥取県"},
    {"lg_code": "32", "area_id": "shimane",   "area_name": "島根県"},
    {"lg_code": "33", "area_id": "okayama",   "area_name": "岡山県"},
    {"lg_code": "34", "area_id": "hiroshima", "area_name": "広島県"},
    {"lg_code": "35", "area_id": "yamaguchi", "area_name": "山口県"},
    {"lg_code": "36", "area_id": "tokushima", "area_name": "徳島県"},
    {"lg_code": "37", "area_id": "kagawa",    "area_name": "香川県"},
    {"lg_code": "38", "area_id": "ehime",     "area_name": "愛媛県"},
    {"lg_code": "39", "area_id": "kochi",     "area_name": "高知県"},
    {"lg_code": "40", "area_id": "fukuoka",   "area_name": "福岡県"},
    {"lg_code": "41", "area_id": "saga",      "area_name": "佐賀県"},
    {"lg_code": "42", "area_id": "nagasaki",  "area_name": "長崎県"},
    {"lg_code": "43", "area_id": "kumamoto",  "area_name": "熊本県"},
    {"lg_code": "44", "area_id": "oita",      "area_name": "大分県"},
    {"lg_code": "45", "area_id": "miyazaki",  "area_name": "宮崎県"},
    {"lg_code": "46", "area_id": "kagoshima", "area_name": "鹿児島県"},
    {"lg_code": "47", "area_id": "okinawa",   "area_name": "沖縄県"},
]


# ───────────────────────────────────────────────
# Supabase REST helpers
# ───────────────────────────────────────────────

def _sb_headers(prefer="return=representation"):
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


def _sb_url(path):
    return f"{SUPABASE_URL}/rest/v1{path}"


# ───────────────────────────────────────────────
# area_sources 投入
# ───────────────────────────────────────────────

def insert_area_sources():
    """全47都道府県の area_sources を DB に追加する。
    既存のものは ON CONFLICT でスキップ。
    """
    logger.info("=== area_sources 投入開始 ===")

    records = []
    for pref in PREFECTURES:
        source_id = f"kkj-{pref['area_id']}"
        url = f"{KKJ_API}?LG_Code={pref['lg_code']}"
        records.append({
            "id": source_id,
            "area_id": pref["area_id"],
            "area_name": pref["area_name"],
            "source_name": f"官公需ポータル - {pref['area_name']}",
            "url": url,
            "active": True,
            "notes": "api:kkj",
        })

    inserted = 0
    skipped = 0

    for rec in records:
        try:
            resp = requests.post(
                _sb_url("/area_sources"),
                headers={
                    **_sb_headers("return=representation"),
                    "Prefer": "resolution=merge-duplicates,return=representation",
                },
                json=rec,
                timeout=10,
            )
            if resp.ok:
                inserted += 1
            else:
                skipped += 1
                logger.debug("area_source skip %s: %s", rec["id"], resp.text[:100])
        except Exception as e:
            skipped += 1
            logger.debug("area_source error %s: %s", rec["id"], e)

    logger.info("area_sources: %d件追加 / %d件スキップ", inserted, skipped)
    return inserted


# ───────────────────────────────────────────────
# kkj.go.jp API 呼び出し & XML パース
# ───────────────────────────────────────────────

def fetch_kkj_opportunities(lg_code, start_date, end_date):
    """kkj.go.jp API を呼び出して案件を取得する。

    Returns:
        list[dict]: 案件情報のリスト
    """
    params = {
        "LG_Code": lg_code,
        "Start_Date": start_date,
        "End_Date": end_date,
    }
    resp = requests.get(KKJ_API, params=params, timeout=30)
    resp.raise_for_status()
    return parse_kkj_xml(resp.content)


def parse_kkj_xml(xml_bytes):
    """kkj.go.jp API の XML レスポンスをパースして案件リストに変換する。

    Returns:
        list[dict]: 案件情報 (upsert_opportunities に渡す形式)
    """
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

        # Category/ProcedureType のマッピング
        category_raw = _xml_text(sr, "Category") or ""
        category = _map_category(category_raw)
        method_raw = _xml_text(sr, "ProcedureType") or ""
        method = _map_method(method_raw)

        # detail_url: Key から固有URL生成（ExternalDocumentURI は共通URLのため）
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
            "category": category,
            "method": method,
            "deadline": None,
            "budget": None,
            "summary": summary,
            "detail_url": detail_url,
            "requirements": _xml_text(sr, "Certification"),
        }
        results.append(item)

    return results


def _xml_text(element, tag):
    """XMLタグのテキストを安全に取得する。"""
    child = element.find(tag)
    if child is not None and child.text:
        return child.text.strip()
    return None


def _map_category(raw):
    """kkj.go.jp の Category を koubo-navi の category にマッピング。"""
    mapping = {
        "物品": "物品",
        "工事": "建設",
        "役務": "サービス",
    }
    return mapping.get(raw, raw or "その他")


def _map_method(raw):
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


def _clean_summary(raw, title):
    """ProjectDescription から要約を作成する。"""
    if not raw:
        return None
    text = raw.strip()
    # タイトルの繰り返しが先頭にある場合は除去
    if text.startswith(title):
        text = text[len(title):].strip()
    # 改行を空白に変換
    text = " ".join(text.split())
    # 「調達案件番号XXXXX」を除去
    import re
    text = re.sub(r"調達案件番号\d+", "", text)
    text = text.strip()
    # 200文字で切る
    if len(text) > 200:
        text = text[:197] + "..."
    return text if text else None


# ───────────────────────────────────────────────
# メイン処理
# ───────────────────────────────────────────────

def run_load(dry_run=False, prefectures=None):
    """初期データ投入のメイン処理。

    Args:
        dry_run: True の場合、DB 保存せずに API 取得のみテストする。
        prefectures: 処理する都道府県リスト（None で全47）。
    """
    target_prefs = prefectures or PREFECTURES

    logger.info("=" * 60)
    logger.info("公募ナビAI - 全47都道府県 初期データ投入")
    if dry_run:
        logger.info("  *** DRY-RUN モード（DB保存しません）***")
    logger.info("  対象: %d都道府県", len(target_prefs))
    logger.info("=" * 60)

    # ── Step 1: area_sources 投入 ──
    if not dry_run:
        insert_area_sources()
    else:
        logger.info("(dry-run) area_sources 投入スキップ")

    # ── Step 2: 30日分のデータを取得 ──
    logger.info("")
    logger.info("=== 案件データ取得開始（過去30日分）===")

    now = datetime.now(timezone.utc)
    total_saved = 0
    total_fetched = 0
    results_per_pref = {}

    # 週ごとに分割して API 呼び出し（日付範囲でレスポンスが異なる可能性あり）
    weeks = []
    for w in range(5):  # 5週間分（重複あり。UNIQUE制約で重複は除去される）
        end = now - timedelta(days=w * 7)
        start = end - timedelta(days=7)
        weeks.append((start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")))

    for pref in target_prefs:
        pref_saved = 0
        pref_fetched = 0
        errors = 0

        for start_date, end_date in weeks:
            try:
                opps = fetch_kkj_opportunities(
                    pref["lg_code"], start_date, end_date
                )
                pref_fetched += len(opps)

                if opps and not dry_run:
                    source_id = f"kkj-{pref['area_id']}"
                    saved = upsert_opportunities(opps, pref["area_id"], source_id)
                    pref_saved += len(saved)
                elif opps and dry_run:
                    pref_saved += len(opps)

                # API レートリミット対策: 1秒待機
                time.sleep(1)

            except Exception as e:
                errors += 1
                logger.warning(
                    "  %s week(%s~%s) エラー: %s",
                    pref["area_name"], start_date, end_date, e,
                )
                time.sleep(2)

        total_saved += pref_saved
        total_fetched += pref_fetched
        results_per_pref[pref["area_id"]] = {
            "name": pref["area_name"],
            "fetched": pref_fetched,
            "saved": pref_saved,
            "errors": errors,
        }

        status = "OK" if errors == 0 else f"WARN({errors}err)"
        logger.info(
            "  %s: 取得=%d件, 保存=%d件 [%s]",
            pref["area_name"], pref_fetched, pref_saved, status,
        )

    # ── Step 3: サマリー出力 ──
    logger.info("")
    logger.info("=" * 60)
    logger.info("完了サマリー")
    logger.info("=" * 60)
    logger.info("全取得件数: %d件", total_fetched)
    logger.info("全保存件数: %d件（重複除外後）", total_saved)
    logger.info("")

    sorted_prefs = sorted(
        results_per_pref.items(),
        key=lambda x: x[1]["saved"],
        reverse=True,
    )
    logger.info("保存件数 Top 10:")
    for i, (area_id, info) in enumerate(sorted_prefs[:10], 1):
        logger.info(
            "  %2d. %s: %d件", i, info["name"], info["saved"]
        )

    error_prefs = [
        (aid, info) for aid, info in results_per_pref.items()
        if info["errors"] > 0
    ]
    if error_prefs:
        logger.info("")
        logger.info("エラーがあったエリア:")
        for aid, info in error_prefs:
            logger.info("  %s: %d回のエラー", info["name"], info["errors"])

    zero_prefs = [
        info["name"] for _, info in results_per_pref.items()
        if info["saved"] == 0
    ]
    if zero_prefs:
        logger.info("")
        logger.info("0件のエリア: %s", ", ".join(zero_prefs))

    logger.info("")
    if dry_run:
        logger.info("DRY-RUN 完了。実行する場合は --dry-run なしで再実行してください。")
    else:
        logger.info("初期データ投入が完了しました。")
        logger.info("今後は daily_check.py による日次バッチで差分が追加されます。")

    return results_per_pref


def main():
    import argparse

    parser = argparse.ArgumentParser(description="公募ナビAI 全47都道府県 初期データ投入")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="DB保存せずにAPI取得のみテストする",
    )
    parser.add_argument(
        "--pref", type=str, default=None,
        help="特定の都道府県のみ処理する（area_id, 例: tokyo,aichi）",
    )
    args = parser.parse_args()

    if not args.dry_run and not SUPABASE_SERVICE_KEY:
        logger.error("SUPABASE_SERVICE_KEY が設定されていません。")
        logger.error("  export SUPABASE_SERVICE_KEY=sb_secret_...")
        logger.error("  または --dry-run でAPIテストのみ実行")
        sys.exit(1)

    # 特定の都道府県のみ処理
    target_prefs = None
    if args.pref:
        pref_ids = [p.strip() for p in args.pref.split(",")]
        target_prefs = [p for p in PREFECTURES if p["area_id"] in pref_ids]
        if not target_prefs:
            logger.error("指定された都道府県が見つかりません: %s", args.pref)
            sys.exit(1)

    run_load(dry_run=args.dry_run, prefectures=target_prefs)


if __name__ == "__main__":
    main()
