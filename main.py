#!/usr/bin/env python3
"""公募ナビ AI - 試作版 v0.1

自社のウェブサイトをAIに読ませて事業内容を把握し、
行政の公募・入札案件をエリア別に自動収集して、
自社にマッチする案件をAIが判定・推薦するサービスのプロトタイプ。

使い方:
  python main.py                          # 対話モード
  python main.py https://bantex.jp aichi  # コマンドライン指定
"""
import json
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config
from company_analyzer import analyze_company
from gov_scraper import scrape_area, scrape_custom_url
from matcher import match_opportunities

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


def print_banner():
    print()
    print("=" * 60)
    print("  公募ナビ AI - 試作版 v0.1")
    print("  自社HP × 行政公募 AIマッチング")
    print("=" * 60)
    print()


def select_area() -> str:
    """エリアを対話的に選択させる。"""
    print("エリアを選択してください:")
    areas = list(config.AREAS.items())
    for i, (key, area) in enumerate(areas, 1):
        n = len(area["sources"])
        print(f"  {i}. {area['name']} ({n}データソース)")
    print(f"  {len(areas) + 1}. カスタムURL入力")
    print()

    while True:
        try:
            raw = input("番号を入力 > ").strip()
            choice = int(raw)
            if 1 <= choice <= len(areas):
                return areas[choice - 1][0]
            if choice == len(areas) + 1:
                return "__custom__"
        except (ValueError, EOFError):
            pass
        print("  正しい番号を入力してください")


def display_results(company: dict, matches: list[dict]):
    """マッチング結果をコンソールに表示する。"""
    print()
    print("=" * 60)
    print("  マッチング結果")
    print("=" * 60)
    print()

    cn = company.get("company_name", "不明")
    ba = ", ".join(company.get("business_areas", [])[:5])
    svcs = ", ".join(company.get("services", [])[:5])
    print(f"  会社名  : {cn}")
    print(f"  事業分野: {ba}")
    print(f"  サービス: {svcs}")
    print(f"  検出案件: {len(matches)}件")
    print("-" * 60)

    if not matches:
        print("\n  マッチする案件が見つかりませんでした。")
        print("  ヒント: config.py の AREAS にデータソースURLを追加してください。")
        return

    for i, m in enumerate(matches, 1):
        score = m.get("match_score", 0)

        if score >= 80:
            stars = "★★★"
        elif score >= 60:
            stars = "★★ "
        elif score >= 40:
            stars = "★  "
        else:
            stars = "   "

        rec = m.get("recommendation", "")
        print(f"\n  [{i}] {stars} マッチ度: {score}%  ({rec})")
        print(f"      案件: {m.get('title', '不明')}")
        print(f"      発注: {m.get('organization', '不明')}")
        print(f"      分類: {m.get('category', '不明')} / {m.get('method', '不明')}")

        if m.get("budget"):
            print(f"      予算: {m['budget']}")
        if m.get("deadline"):
            print(f"      締切: {m['deadline']}")

        print(f"      理由: {m.get('match_reason', '-')}")

        if m.get("risk_notes"):
            print(f"      注意: {m['risk_notes']}")

        actions = m.get("action_items", [])
        if actions:
            print(f"      ToDo: {', '.join(actions)}")

        if m.get("detail_url"):
            print(f"      URL : {m['detail_url']}")

    print()
    print("-" * 60)


def main():
    print_banner()

    if not config.GEMINI_API_KEY:
        print("エラー: GEMINI_API_KEY が設定されていません。")
        print()
        print("  .env ファイルに記載するか、環境変数を設定してください:")
        print("    export GEMINI_API_KEY='your-api-key'")
        print()
        print("  または .env ファイルを作成:")
        print("    echo GEMINI_API_KEY=your-key > .env")
        sys.exit(1)

    # --- 入力 ---
    if len(sys.argv) >= 3:
        company_url = sys.argv[1]
        area_key = sys.argv[2]
    else:
        company_url = input("会社のURLを入力: ").strip()
        if not company_url:
            print("URLが入力されませんでした。")
            sys.exit(1)
        print()
        area_key = select_area()

    if not company_url.startswith("http"):
        company_url = "https://" + company_url
    print()

    # --- Step 1: 会社分析 ---
    print(f"[Step 1/3] 会社情報を分析中... ({company_url})")
    try:
        company = analyze_company(company_url)
        cn = company.get("company_name", "不明")
        ba = ", ".join(company.get("business_areas", [])[:3])
        kw = ", ".join(company.get("matching_keywords", [])[:5])
        print(f"  OK  {cn}")
        print(f"      事業: {ba}")
        print(f"      KW  : {kw}")
    except Exception as exc:
        logger.error("会社分析に失敗: %s", exc)
        sys.exit(1)
    print()

    # --- Step 2: 公募情報収集 ---
    if area_key == "__custom__":
        custom_url = input("行政ページのURLを入力: ").strip()
        print()
        print(f"[Step 2/3] カスタムURLから公募情報を収集中...")
        try:
            opportunities = scrape_custom_url(custom_url)
            print(f"  OK  {len(opportunities)}件の案件を検出")
        except Exception as exc:
            logger.error("公募情報の取得に失敗: %s", exc)
            sys.exit(1)
        area_name = "カスタム"
    else:
        area_name = config.AREAS[area_key]["name"]
        print(f"[Step 2/3] {area_name}の公募・入札情報を収集中...")
        try:
            opportunities = scrape_area(area_key)
            print(f"  OK  {len(opportunities)}件の案件を検出")
        except Exception as exc:
            logger.error("公募情報の取得に失敗: %s", exc)
            sys.exit(1)
    print()

    if not opportunities:
        print("公募・入札案件が見つかりませんでした。")
        print()
        print("考えられる原因:")
        print("  - 対象ページに現在案件が掲載されていない")
        print("  - URLが変更されている")
        print("  - ページ構造が想定と異なる")
        print()
        print("対処法:")
        print("  - config.py の AREAS に別のURLを追加する")
        print("  - カスタムURL入力で個別ページを試す")
        return

    # --- Step 3: マッチング ---
    print(f"[Step 3/3] AIマッチング判定中... ({len(opportunities)}件)")
    try:
        matches = match_opportunities(company, opportunities)
        print(f"  OK  マッチング完了")
    except Exception as exc:
        logger.error("マッチング判定に失敗: %s", exc)
        sys.exit(1)

    # --- 結果表示 ---
    display_results(company, matches)

    # --- JSON保存 ---
    output = {
        "company_profile": company,
        "area": area_name,
        "opportunities_found": len(opportunities),
        "matches": matches,
    }
    out_dir = os.path.dirname(os.path.abspath(__file__))
    output_path = os.path.join(out_dir, "result.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2, default=str)
    print(f"\n詳細結果を保存: {output_path}")


if __name__ == "__main__":
    main()
