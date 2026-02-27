"""公募ナビAI - 日次バッチ処理 v3.0

Render.com Cron Job から呼び出され、以下を実行:
1. 全ソースをスクレイピング → opportunities 保存
1.5. 詳細ページ取得 + 業種カテゴリ分類（Gemini）
2. ユーザーごとに業種マッチ新着案件 → AI詳細分析 → メール通知
"""

import logging
import traceback
from datetime import datetime, timezone

import db
from detail_scraper import enrich_batch
from gov_scraper import scrape_source
from notifier import notify_user

logger = logging.getLogger(__name__)


def run_daily_check():
    """日次バッチのメイン処理。"""
    log_id = None
    stats = {
        "users_processed": 0,
        "opportunities_scraped": 0,
        "details_enriched": 0,
        "notifications_sent": 0,
        "errors_count": 0,
        "error_details": [],
    }

    try:
        # バッチログ開始（失敗してもバッチ処理は継続）
        try:
            log_id = db.create_batch_log()
            logger.info("=== バッチ開始 (log_id=%s) ===", log_id)
        except Exception as log_exc:
            logger.warning("バッチログ作成失敗（処理は継続）: %s", log_exc)
            log_id = None

        # =====================================================
        # Phase 1: 全ソースをスクレイピング（ユーザー有無に関係なく）
        # =====================================================
        all_sources = db.get_all_active_sources()
        logger.info("全アクティブソース: %d件", len(all_sources))

        # エリアごとにグルーピング
        sources_by_area = {}
        for src in all_sources:
            aid = src["area_id"]
            if aid not in sources_by_area:
                sources_by_area[aid] = []
            sources_by_area[aid].append(src)

        for area_id, sources in sources_by_area.items():
            logger.info("--- エリア: %s (%d sources) ---", area_id, len(sources))

            for source in sources:
                source_id = source["id"]
                try:
                    raw_opps = scrape_source(source)
                    db.update_source_status(source_id, success=True)

                    if raw_opps:
                        saved = db.upsert_opportunities(raw_opps, area_id, source_id)
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

        logger.info("スクレイピング完了: 合計 %d件", stats["opportunities_scraped"])

        # =====================================================
        # Phase 1.5: 詳細取得 + 業種分類（detail_url有 & 未取得の案件）
        # =====================================================
        try:
            unenriched = db.get_unenriched_opportunities(limit=500)
            if unenriched:
                logger.info("=== 詳細取得フェーズ: %d件 ===", len(unenriched))
                results = enrich_batch(unenriched, batch_size=10, delay=0.5)
                enriched_count = 0
                for opp_id, details in results:
                    try:
                        db.update_opportunity_details(opp_id, details)
                        enriched_count += 1
                    except Exception as exc:
                        logger.debug("詳細更新失敗 %s: %s", opp_id, exc)
                logger.info("詳細取得完了: %d/%d 成功", enriched_count, len(unenriched))
                stats["details_enriched"] = enriched_count
            else:
                logger.info("詳細未取得の案件なし")
                stats["details_enriched"] = 0
        except Exception as exc:
            logger.error("詳細取得フェーズ失敗: %s", exc)
            stats["errors_count"] += 1
            stats["error_details"].append({
                "phase": "detail_enrich",
                "error": str(exc),
            })

        # =====================================================
        # Phase 2: ユーザーごとに業種マッチ通知
        # =====================================================
        users = db.get_active_users()
        logger.info("アクティブユーザー: %d人", len(users))

        if not users:
            logger.info("ユーザーなし。スクレイピングのみ完了。")
            _finish_log(log_id, stats, "completed")
            return stats

        logger.info("=== 通知フェーズ ===")
        for user in users:
            if not user.get("email_notify", True):
                stats["users_processed"] += 1
                continue
            try:
                notified_count = notify_user(user)
                stats["notifications_sent"] += notified_count
                stats["users_processed"] += 1
            except Exception as exc:
                logger.error("通知失敗 user=%s: %s", user["id"], exc)
                stats["errors_count"] += 1
                stats["error_details"].append({
                    "phase": "notify",
                    "user_id": user["id"],
                    "error": str(exc),
                })
                stats["users_processed"] += 1

        # 完了
        status = "completed" if stats["errors_count"] == 0 else "completed_with_errors"
        _finish_log(log_id, stats, status)

        logger.info(
            "=== バッチ完了 === users=%d, opps=%d, enriched=%d, notified=%d, errors=%d",
            stats["users_processed"],
            stats["opportunities_scraped"],
            stats["details_enriched"],
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
            notifications_sent=stats["notifications_sent"],
            errors_count=stats["errors_count"],
            error_details=stats["error_details"] if stats["error_details"] else None,
        )
    except Exception as exc:
        logger.error("バッチログ更新失敗: %s", exc)
