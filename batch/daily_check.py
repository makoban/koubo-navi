"""公募ナビAI - 日次バッチ処理

Render.com Cron Job から呼び出され、以下を実行:
1. アクティブユーザーの対象エリアを集約
2. エリアごとにデータソースをスクレイピング
3. 案件を opportunities テーブルに保存
4. ユーザーごとに AI マッチングを実行
5. マッチング結果を保存
6. メール通知を送信
"""

import logging
import traceback
from datetime import datetime, timezone

import db
from gov_scraper import scrape_source
from matcher import match_opportunities
from notifier import notify_user

logger = logging.getLogger(__name__)


def run_daily_check():
    """日次バッチのメイン処理。"""
    log_id = None
    stats = {
        "users_processed": 0,
        "opportunities_scraped": 0,
        "matches_created": 0,
        "notifications_sent": 0,
        "errors_count": 0,
        "error_details": [],
    }

    try:
        # バッチログ開始
        log_id = db.create_batch_log()
        logger.info("=== バッチ開始 (log_id=%s) ===", log_id)

        # 0. 未スクリーニングユーザーのフォールバックチェック
        _run_initial_screening_fallback()

        # 1. アクティブユーザーを取得
        users = db.get_active_users()
        logger.info("アクティブユーザー: %d人", len(users))

        if not users:
            logger.info("処理対象ユーザーなし。終了。")
            _finish_log(log_id, stats, "completed")
            return stats

        # 2. 必要なエリアを集約
        required_areas = set()
        user_areas_map = {}  # user_id -> [area_id, ...]

        for user in users:
            user_id = user["id"]
            areas = db.get_user_areas(user_id)
            user_areas_map[user_id] = areas
            required_areas.update(areas)

        logger.info("対象エリア: %s", required_areas)

        # 3. エリアごとにスクレイピング
        area_opportunities = {}  # area_id -> [opportunity records with DB id]

        for area_id in required_areas:
            logger.info("--- エリア: %s ---", area_id)
            sources = db.get_area_sources(area_id)

            if not sources:
                logger.warning("エリア %s のソースなし", area_id)
                continue

            area_opps = []

            for source in sources:
                source_id = source["id"]
                try:
                    raw_opps = scrape_source(source)
                    db.update_source_status(source_id, success=True)

                    if raw_opps:
                        saved = db.upsert_opportunities(raw_opps, area_id, source_id)
                        area_opps.extend(saved)
                        stats["opportunities_scraped"] += len(saved)

                except Exception as exc:
                    logger.error("ソース %s スクレイピング失敗: %s", source_id, exc)
                    db.update_source_status(source_id, success=False)
                    stats["errors_count"] += 1
                    stats["error_details"].append({
                        "phase": "scrape",
                        "source_id": source_id,
                        "error": str(exc),
                    })

            area_opportunities[area_id] = area_opps

        logger.info("スクレイピング完了: 合計 %d件", stats["opportunities_scraped"])

        # 4. ユーザーごとにマッチング
        for user in users:
            user_id = user["id"]
            logger.info("--- マッチング: user=%s ---", user_id)

            try:
                profile = db.get_user_profile(user_id)
                if not profile:
                    logger.warning("プロフィール未設定: %s", user_id)
                    continue

                # ユーザーのエリアに該当する案件を集める
                user_opps = []
                for area_id in user_areas_map.get(user_id, []):
                    user_opps.extend(area_opportunities.get(area_id, []))

                if not user_opps:
                    logger.info("対象案件なし: %s", user_id)
                    stats["users_processed"] += 1
                    continue

                logger.info("マッチング対象: %d件", len(user_opps))

                # AI マッチング
                matches = match_opportunities(profile, user_opps)
                logger.info("マッチング結果: %d件", len(matches))

                # DB保存
                if matches:
                    db.save_user_opportunities(user_id, matches)
                    stats["matches_created"] += len(matches)

                stats["users_processed"] += 1

            except Exception as exc:
                logger.error("ユーザー %s マッチング失敗: %s", user_id, exc)
                stats["errors_count"] += 1
                stats["error_details"].append({
                    "phase": "matching",
                    "user_id": user_id,
                    "error": str(exc),
                })

        # 5. メール通知
        logger.info("=== 通知フェーズ ===")
        for user in users:
            if not user.get("email_notify", True):
                continue
            try:
                notified_count = notify_user(user)
                stats["notifications_sent"] += notified_count
            except Exception as exc:
                logger.error("通知失敗 user=%s: %s", user["id"], exc)
                stats["errors_count"] += 1
                stats["error_details"].append({
                    "phase": "notify",
                    "user_id": user["id"],
                    "error": str(exc),
                })

        # 完了
        status = "completed" if stats["errors_count"] == 0 else "completed_with_errors"
        _finish_log(log_id, stats, status)

        logger.info(
            "=== バッチ完了 === users=%d, opps=%d, matches=%d, notified=%d, errors=%d",
            stats["users_processed"],
            stats["opportunities_scraped"],
            stats["matches_created"],
            stats["notifications_sent"],
            stats["errors_count"],
        )

    except Exception as exc:
        logger.critical("バッチ致命的エラー: %s\n%s", exc, traceback.format_exc())
        stats["errors_count"] += 1
        stats["error_details"].append({
            "phase": "fatal",
            "error": str(exc),
            "traceback": traceback.format_exc(),
        })
        if log_id:
            _finish_log(log_id, stats, "failed")

    return stats


def _run_initial_screening_fallback():
    """Worker のタイムアウト等で初期スクリーニングが完了しなかったユーザーを補完する。"""
    try:
        unscreened = db.get_unscreened_users()
        if not unscreened:
            return

        logger.info("=== 未スクリーニングユーザー: %d人 ===", len(unscreened))

        for user in unscreened:
            user_id = user["id"]
            try:
                profile = db.get_user_profile(user_id)
                if not profile:
                    logger.warning("プロフィール未設定(スクリーニング): %s", user_id)
                    continue

                areas = db.get_user_areas(user_id)
                if not areas:
                    logger.warning("エリア未設定(スクリーニング): %s", user_id)
                    db.mark_screening_done(user_id)
                    continue

                # 過去30日分の案件を集める
                from datetime import timedelta
                import requests as req

                since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
                area_filter = ",".join(f"area_id.eq.{a}" for a in areas)

                resp = req.get(
                    db._url(
                        f"/opportunities?or=({area_filter})"
                        f"&scraped_at=gte.{since}"
                        "&select=*&order=scraped_at.desc&limit=300"
                    ),
                    headers=db._headers(),
                    timeout=30,
                )
                resp.raise_for_status()
                opps = resp.json()

                if not opps:
                    logger.info("対象案件なし(スクリーニング): %s", user_id)
                    db.mark_screening_done(user_id)
                    continue

                logger.info("スクリーニング対象: %d件 (user=%s)", len(opps), user_id)

                matches = match_opportunities(profile, opps)
                if matches:
                    db.save_user_opportunities(user_id, matches)
                    logger.info("スクリーニング結果: %d件マッチ (user=%s)", len(matches), user_id)

                db.mark_screening_done(user_id)

            except Exception as exc:
                logger.error("スクリーニング失敗 user=%s: %s", user_id, exc)

    except Exception as exc:
        logger.error("未スクリーニングチェック失敗: %s", exc)


def _finish_log(log_id: str, stats: dict, status: str):
    """バッチログを完了状態に更新する。"""
    if not log_id:
        return
    try:
        db.update_batch_log(
            log_id,
            finished_at=datetime.now(timezone.utc).isoformat(),
            status=status,
            users_processed=stats["users_processed"],
            opportunities_scraped=stats["opportunities_scraped"],
            matches_created=stats["matches_created"],
            notifications_sent=stats["notifications_sent"],
            errors_count=stats["errors_count"],
            error_details=stats["error_details"] if stats["error_details"] else None,
        )
    except Exception as exc:
        logger.error("バッチログ更新失敗: %s", exc)
