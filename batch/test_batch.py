#!/usr/bin/env python3
"""公募ナビAI - バッチ処理ローカル単体テスト

各モジュール（scraper, gemini_client, matcher, db, notifier）を
個別にテストして動作確認する。
"""

import json
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 環境変数設定（ローカルテスト用）
os.environ.setdefault("GEMINI_API_KEY", os.environ.get("GEMINI_API_KEY", ""))
os.environ.setdefault("SUPABASE_URL", os.environ.get("SUPABASE_URL", ""))
os.environ.setdefault("SUPABASE_SERVICE_KEY", os.environ.get("SUPABASE_SERVICE_KEY", ""))

import config
import db
import scraper
import gemini_client

logging.basicConfig(level=logging.INFO, format="%(message)s")

passed = 0
failed = 0
results = []


def report(name, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"  PASS  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name} - {detail}")
    results.append({"name": name, "ok": ok, "detail": detail})


def test_config():
    """Config モジュールのテスト"""
    print("\n=== Config ===\n")
    report("Config: GEMINI_API_KEY set", bool(config.GEMINI_API_KEY))
    report("Config: SUPABASE_URL set", bool(config.SUPABASE_URL))
    report("Config: SUPABASE_SERVICE_KEY set", bool(config.SUPABASE_SERVICE_KEY))
    report("Config: BATCH_SIZE is 15", config.BATCH_SIZE == 15)


def test_scraper():
    """Scraper モジュールのテスト"""
    print("\n=== Scraper ===\n")

    # fetch_page: bantex.jp（確実に存在するページ）
    try:
        resp = scraper.fetch_page("https://bantex.jp/")
        report("Scraper: fetch_page (bantex.jp)", resp.status_code == 200,
               f"status={resp.status_code}, length={len(resp.content)}")
    except Exception as e:
        report("Scraper: fetch_page (bantex.jp)", False, str(e))
        return

    # extract_text
    try:
        text = scraper.extract_text(resp.content, include_links=True,
                                     base_url="https://bantex.jp/")
        report("Scraper: extract_text (text)", len(text) > 50,
               f"length={len(text)}")
        has_links = "link" in text.lower() or "http" in text.lower()
        report("Scraper: extract_text (links)", has_links or len(text) > 100)
    except Exception as e:
        report("Scraper: extract_text", False, str(e))


def test_gemini():
    """Gemini Client モジュールのテスト"""
    print("\n=== Gemini Client ===\n")

    # call_gemini: シンプルなJSON応答テスト
    try:
        resp = gemini_client.call_gemini(
            '["hello", "world"] の配列を返してください。他に何も書かないで。',
            json_mode=True,
            max_tokens=100,
        )
        report("Gemini: call_gemini (API call)", bool(resp),
               f"response_length={len(resp)}")
    except Exception as e:
        report("Gemini: call_gemini", False, str(e))
        return

    # parse_json_response
    try:
        parsed = gemini_client.parse_json_response(resp)
        report("Gemini: parse_json_response", isinstance(parsed, list),
               f"parsed={parsed}")
    except Exception as e:
        report("Gemini: parse_json_response", False, str(e))

    # parse_json_response with markdown code block
    try:
        test_input = '```json\n["a", "b"]\n```'
        parsed2 = gemini_client.parse_json_response(test_input)
        report("Gemini: parse markdown code block", parsed2 == ["a", "b"],
               f"parsed={parsed2}")
    except Exception as e:
        report("Gemini: parse markdown code block", False, str(e))


def test_db():
    """DB モジュールのテスト"""
    print("\n=== DB Operations ===\n")

    # Reload db module to pick up env vars
    import importlib
    importlib.reload(db)

    # get_active_users
    try:
        users = db.get_active_users()
        report("DB: get_active_users", isinstance(users, list),
               f"{len(users)} users found")
    except Exception as e:
        report("DB: get_active_users", False, str(e))

    # get_area_sources
    try:
        sources = db.get_area_sources("aichi")
        report("DB: get_area_sources (aichi)", isinstance(sources, list),
               f"{len(sources)} sources found")
    except Exception as e:
        report("DB: get_area_sources", False, str(e))

    # create_batch_log
    log_id = None
    try:
        log_id = db.create_batch_log()
        report("DB: create_batch_log", bool(log_id),
               f"log_id={str(log_id)[:8]}..." if log_id else "no id")
    except Exception as e:
        report("DB: create_batch_log", False, str(e))

    # update_batch_log
    if log_id:
        try:
            from datetime import datetime, timezone
            db.update_batch_log(
                log_id,
                finished_at=datetime.now(timezone.utc).isoformat(),
                status="test_completed",
                users_processed=0,
                opportunities_scraped=0,
                matches_created=0,
                notifications_sent=0,
                errors_count=0,
            )
            report("DB: update_batch_log", True)
        except Exception as e:
            report("DB: update_batch_log", False, str(e))

    # Test with a specific user's areas (if users exist)
    if users:
        try:
            first_user_id = users[0]["id"]
            areas = db.get_user_areas(first_user_id)
            report("DB: get_user_areas", isinstance(areas, list),
                   f"user={first_user_id[:8]}..., areas={areas}")
        except Exception as e:
            report("DB: get_user_areas", False, str(e))

        try:
            profile = db.get_user_profile(first_user_id)
            report("DB: get_user_profile", profile is None or isinstance(profile, dict),
                   f"has_profile={profile is not None}")
        except Exception as e:
            report("DB: get_user_profile", False, str(e))


def test_gov_scraper_extraction():
    """Gov Scraper のGemini抽出テスト（実際のページ使用）"""
    print("\n=== Gov Scraper (Gemini Extraction) ===\n")

    from gov_scraper import scrape_source

    # テスト用のソースデータ（名古屋市入札情報）
    test_source = {
        "id": "test-nagoya-city",
        "source_name": "名古屋市電子調達",
        "url": "https://www.chotatsu.city.nagoya.jp/",
    }

    try:
        opportunities = scrape_source(test_source)
        report("GovScraper: scrape_source (愛知県)", isinstance(opportunities, list),
               f"{len(opportunities)} opportunities found")

        if opportunities:
            first = opportunities[0]
            has_title = bool(first.get("title"))
            report("GovScraper: opportunity has title", has_title,
                   f"title={first.get('title', '(none)')[:50]}")

            has_category = bool(first.get("category"))
            report("GovScraper: opportunity has category", has_category,
                   f"category={first.get('category', '(none)')}")
    except Exception as e:
        report("GovScraper: scrape_source", False, str(e)[:200])


def test_matcher():
    """Matcher モジュールのテスト（ダミーデータ使用）"""
    print("\n=== Matcher ===\n")

    from matcher import match_opportunities

    # ダミー会社プロフィール
    profile = {
        "company_name": "バンテックス株式会社",
        "business_areas": ["ITサービス", "DX推進", "AI開発"],
        "services": ["Webアプリ開発", "AI市場分析ツール", "業務効率化コンサル"],
        "strengths": ["AIを活用した自動化", "クラウドサービス開発"],
        "qualifications": [],
        "matching_keywords": ["AI開発", "DX推進", "業務委託"],
    }

    # ダミー案件
    opportunities = [
        {
            "id": "test-opp-1",
            "title": "AIを活用した業務効率化システム開発委託",
            "organization": "テスト県 総務部",
            "category": "IT",
            "method": "企画競争",
            "budget": "10,000,000円",
            "summary": "AIを用いた業務効率化のためのシステム開発",
            "requirements": "AI開発実績3年以上",
        },
        {
            "id": "test-opp-2",
            "title": "庁舎清掃業務委託",
            "organization": "テスト市",
            "category": "清掃",
            "method": "一般競争入札",
            "budget": "5,000,000円",
            "summary": "庁舎の日常清掃及び定期清掃業務",
            "requirements": "清掃業務実績5年以上",
        },
    ]

    try:
        matches = match_opportunities(profile, opportunities)
        report("Matcher: match_opportunities returns list", isinstance(matches, list),
               f"{len(matches)} matches")

        if matches:
            # AI案件は清掃案件よりスコアが高いはず
            ai_match = next((m for m in matches if m.get("opportunity_id") == "test-opp-1"), None)
            clean_match = next((m for m in matches if m.get("opportunity_id") == "test-opp-2"), None)

            if ai_match:
                report("Matcher: AI案件のスコアあり", ai_match.get("match_score", 0) > 0,
                       f"score={ai_match.get('match_score')}")
                report("Matcher: AI opp score >= 60", ai_match.get("match_score", 0) >= 60,
                       f"score={ai_match.get('match_score')}")
                report("Matcher: match_reason あり", bool(ai_match.get("match_reason")),
                       f"reason={ai_match.get('match_reason', '(none)')[:50]}")
                report("Matcher: recommendation あり", bool(ai_match.get("recommendation")),
                       f"rec={ai_match.get('recommendation')}")

            if clean_match:
                report("Matcher: 清掃案件のスコアが低い (<60)", clean_match.get("match_score", 0) < 60,
                       f"score={clean_match.get('match_score')}")

            if ai_match and clean_match:
                report("Matcher: AI > 清掃のスコア順",
                       ai_match.get("match_score", 0) > clean_match.get("match_score", 0),
                       f"AI={ai_match.get('match_score')} vs 清掃={clean_match.get('match_score')}")
    except Exception as e:
        report("Matcher: match_opportunities", False, str(e)[:200])


def test_notifier():
    """Notifier モジュールのテスト（RESEND_API_KEY なしのスキップ確認）"""
    print("\n=== Notifier ===\n")

    from notifier import send_notification

    # RESEND_API_KEY未設定の場合はスキップされるべき
    dummy_user = {"id": "test-user", "notification_email": "test@test.com"}
    dummy_matches = [{"title": "test", "match_score": 80}]

    result = send_notification(dummy_user, dummy_matches)
    report("Notifier: skips without RESEND_API_KEY", result == False,
           "correctly skipped" if not result else "unexpected success")

    # Empty matches should return False
    result2 = send_notification(dummy_user, [])
    report("Notifier: returns False for empty matches", result2 == False)


def main():
    print("=" * 60)
    print("  公募ナビAI - バッチ処理ローカルテスト")
    print("=" * 60)

    test_config()
    test_scraper()
    test_gemini()
    test_db()
    test_gov_scraper_extraction()
    test_matcher()
    test_notifier()

    print("\n" + "=" * 60)
    print(f"  結果: {passed} PASS / {failed} FAIL (合計 {passed + failed})")
    print("=" * 60)

    if failed > 0:
        print("\n  Failed tests:")
        for r in results:
            if not r["ok"]:
                print(f"    - {r['name']}: {r['detail']}")

    sys.exit(1 if failed > 0 else 0)


if __name__ == "__main__":
    main()
