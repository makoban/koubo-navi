"""公募ナビAI - Supabase DB操作モジュール"""

import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import requests

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://ypyrjsdotkeyvzequdez.supabase.co")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def _headers(prefer: str = "return=representation") -> dict:
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": prefer,
    }


def _url(path: str) -> str:
    return f"{SUPABASE_URL}/rest/v1{path}"


# --- Users ---

def get_active_users() -> list[dict]:
    """アクティブなユーザー一覧（trial or active）を取得。"""
    resp = requests.get(
        _url("/koubo_users?status=in.(active,trial)&select=*"),
        headers=_headers(),
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def get_user_profile(user_id: str) -> Optional[dict]:
    """ユーザーの会社プロフィールを取得。"""
    resp = requests.get(
        _url(f"/company_profiles?user_id=eq.{user_id}&select=*&limit=1"),
        headers=_headers(),
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    return data[0] if data else None


def get_user_areas(user_id: str) -> list[str]:
    """ユーザーのアクティブなエリアIDリストを取得。"""
    resp = requests.get(
        _url(f"/user_areas?user_id=eq.{user_id}&active=eq.true&select=area_id"),
        headers=_headers(),
        timeout=10,
    )
    resp.raise_for_status()
    return [r["area_id"] for r in resp.json()]


# --- Area Sources ---

def get_all_active_sources() -> list[dict]:
    """全エリアのアクティブなデータソースを取得。"""
    resp = requests.get(
        _url("/area_sources?active=eq.true&select=*&order=area_id"),
        headers=_headers(),
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def get_area_sources(area_id: str) -> list[dict]:
    """指定エリアのアクティブなデータソースを取得。"""
    resp = requests.get(
        _url(f"/area_sources?area_id=eq.{area_id}&active=eq.true&select=*"),
        headers=_headers(),
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


def update_source_status(
    source_id: str,
    success: bool,
    last_checked: Optional[str] = None,
):
    """ソースの成功/失敗ステータスを更新。"""
    now = last_checked or datetime.now(timezone.utc).isoformat()
    body: dict = {"last_checked_at": now}

    if success:
        body["last_success_at"] = now
        body["consecutive_failures"] = 0
    else:
        # 失敗カウントをインクリメント（Supabase REST では直接 increment できないのでGET→PATCH）
        resp = requests.get(
            _url(f"/area_sources?id=eq.{source_id}&select=consecutive_failures"),
            headers=_headers(),
            timeout=10,
        )
        resp.raise_for_status()
        current = resp.json()[0].get("consecutive_failures", 0) if resp.json() else 0
        body["consecutive_failures"] = current + 1

    requests.patch(
        _url(f"/area_sources?id=eq.{source_id}"),
        headers=_headers("return=minimal"),
        json=body,
        timeout=10,
    )


# --- Opportunities ---

def get_opportunities_by_areas(
    area_ids: list[str],
    days: int = 30,
    limit: int = 300,
) -> list[dict]:
    """指定エリアの直近N日分の案件を取得。"""
    from datetime import timedelta

    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    area_filter = ",".join(f"area_id.eq.{a}" for a in area_ids)
    resp = requests.get(
        _url(
            f"/opportunities?or=({area_filter})"
            f"&scraped_at=gte.{since}"
            f"&select=*&order=scraped_at.desc&limit={limit}"
        ),
        headers=_headers(),
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def upsert_opportunities(opportunities: list[dict], area_id: str, source_id: str) -> list[dict]:
    """案件をDB保存（重複はスキップ）。保存された案件を返す。"""
    saved = []
    for opp in opportunities:
        record = {
            "area_id": area_id,
            "source_id": source_id,
            "title": (opp.get("title") or "不明")[:500],
            "organization": opp.get("organization"),
            "category": opp.get("category"),
            "method": opp.get("method"),
            "deadline": opp.get("deadline"),
            "budget": opp.get("budget"),
            "summary": opp.get("summary"),
            "requirements": opp.get("requirements"),
            "detail_url": opp.get("detail_url"),
        }
        try:
            resp = requests.post(
                _url("/opportunities"),
                headers={
                    **_headers("return=representation"),
                    "Prefer": "resolution=merge-duplicates,return=representation",
                },
                json=record,
                timeout=10,
            )
            if resp.ok:
                data = resp.json()
                if data:
                    saved.append(data[0] if isinstance(data, list) else data)
        except Exception as e:
            logger.debug("upsert skip: %s", e)

    return saved


# --- Opportunity Detail Enrichment ---

def get_unenriched_opportunities(limit: int = 500) -> list[dict]:
    """詳細未取得の案件を取得する。"""
    resp = requests.get(
        _url(
            "/opportunities?detail_fetched_at=is.null"
            "&detail_url=not.is.null"
            "&select=id,title,detail_url"
            f"&order=scraped_at.desc&limit={limit}"
        ),
        headers=_headers(),
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def update_opportunity_details(opp_id: str, details: dict):
    """案件の詳細フィールドを更新する。"""
    from datetime import datetime, timezone

    body = {"detail_fetched_at": datetime.now(timezone.utc).isoformat()}

    for key in ("published_date", "deadline", "bid_opening_date",
                "contract_period", "briefing_date", "budget",
                "requirements", "contact_info", "detailed_summary",
                "difficulty", "industry_category"):
        val = details.get(key)
        if val is not None:
            body[key] = val

    requests.patch(
        _url(f"/opportunities?id=eq.{opp_id}"),
        headers=_headers("return=minimal"),
        json=body,
        timeout=10,
    )


# --- Industry Category ---

def update_industry_category(opp_id: str, category: str):
    """案件の業種カテゴリを更新する。"""
    requests.patch(
        _url(f"/opportunities?id=eq.{opp_id}"),
        headers=_headers("return=minimal"),
        json={"industry_category": category},
        timeout=10,
    )


def get_new_opportunities_by_industry(
    industry_categories: list[str],
    since_hours: int = 24,
) -> list[dict]:
    """業種カテゴリにマッチする新着案件を取得する。"""
    from datetime import timedelta

    since = (datetime.now(timezone.utc) - timedelta(hours=since_hours)).isoformat()
    cat_filter = ",".join(industry_categories)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    resp = requests.get(
        _url(
            f"/opportunities?industry_category=in.({cat_filter})"
            f"&scraped_at=gte.{since}"
            f"&or=(deadline.is.null,deadline.gte.{today})"
            "&select=*&order=scraped_at.desc&limit=100"
        ),
        headers=_headers(),
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def get_user_industry_categories(user_id: str) -> list[str]:
    """ユーザーの業種カテゴリ配列を取得する。"""
    resp = requests.get(
        _url(f"/company_profiles?user_id=eq.{user_id}&select=industry_categories"),
        headers=_headers(),
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    if data and data[0].get("industry_categories"):
        return data[0]["industry_categories"]
    return []


def save_detailed_analysis(user_id: str, opp_id: str, analysis: dict):
    """AI詳細分析をDBに保存する（user_opportunities upsert）。"""
    now = datetime.now(timezone.utc).isoformat()
    record = {
        "user_id": user_id,
        "opportunity_id": opp_id,
        "detailed_analysis": json.dumps(analysis, ensure_ascii=False),
        "analysis_completed_at": now,
    }
    try:
        requests.post(
            _url("/user_opportunities"),
            headers={
                **_headers("return=minimal"),
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
            json=record,
            timeout=15,
        )
    except Exception as e:
        logger.debug("save analysis skip: %s", e)


def get_cached_analysis(user_id: str, opp_id: str) -> Optional[dict]:
    """キャッシュ済みのAI詳細分析を取得する。"""
    resp = requests.get(
        _url(
            f"/user_opportunities?user_id=eq.{user_id}"
            f"&opportunity_id=eq.{opp_id}"
            "&select=detailed_analysis"
        ),
        headers=_headers(),
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    if data and data[0].get("detailed_analysis"):
        analysis = data[0]["detailed_analysis"]
        if isinstance(analysis, str):
            return json.loads(analysis)
        return analysis
    return None


# --- User Opportunities (Match Results) ---

def save_user_opportunities(user_id: str, matches: list[dict]):
    """ユーザーのマッチング結果を保存（ランク付き）。"""
    # スコア降順でソートし、rank_position を付与
    sorted_matches = sorted(matches, key=lambda m: m.get("match_score", 0), reverse=True)

    for rank, m in enumerate(sorted_matches, start=1):
        opp_id = m.get("opportunity_id")
        if not opp_id:
            continue

        record = {
            "user_id": user_id,
            "opportunity_id": opp_id,
            "match_score": m.get("match_score", 0),
            "match_reason": m.get("match_reason"),
            "risk_notes": m.get("risk_notes"),
            "recommendation": m.get("recommendation"),
            "action_items": m.get("action_items", []),
            "rank_position": rank,
        }
        try:
            requests.post(
                _url("/user_opportunities"),
                headers={
                    **_headers("return=minimal"),
                    "Prefer": "resolution=merge-duplicates,return=minimal",
                },
                json=record,
                timeout=10,
            )
        except Exception as e:
            logger.debug("save match skip: %s", e)


def get_unscreened_users() -> list[dict]:
    """初期スクリーニング未完了のユーザーを取得。"""
    resp = requests.get(
        _url(
            "/koubo_users?status=in.(active,trial)"
            "&initial_screening_done=eq.false"
            "&select=*"
        ),
        headers=_headers(),
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def mark_screening_done(user_id: str):
    """初期スクリーニング完了フラグを更新。"""
    now = datetime.now(timezone.utc).isoformat()
    requests.patch(
        _url(f"/koubo_users?id=eq.{user_id}"),
        headers=_headers("return=minimal"),
        json={"initial_screening_done": True, "initial_screening_at": now},
        timeout=10,
    )


def get_user_tier(user: dict) -> str:
    """ユーザーのティアを判定。paid or free。"""
    status = user.get("status", "")
    trial_end = user.get("trial_ends_at")
    if status == "active":
        return "paid"
    if status == "trial" and trial_end:
        from datetime import datetime, timezone
        try:
            end_dt = datetime.fromisoformat(trial_end.replace("Z", "+00:00"))
            if end_dt > datetime.now(timezone.utc):
                return "paid"
        except (ValueError, TypeError):
            pass
    return "free"


def get_unnotified_matches(user_id: str, threshold: int = 40) -> list[dict]:
    """未通知のマッチング結果を取得。"""
    resp = requests.get(
        _url(
            f"/user_opportunities?user_id=eq.{user_id}"
            f"&is_notified=eq.false"
            f"&match_score=gte.{threshold}"
            "&select=*,opportunities(*)"
            "&order=match_score.desc"
        ),
        headers=_headers(),
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def mark_as_notified(user_id: str, opportunity_ids: list[str]):
    """マッチング結果を通知済みに更新。"""
    now = datetime.now(timezone.utc).isoformat()
    for opp_id in opportunity_ids:
        try:
            requests.patch(
                _url(
                    f"/user_opportunities?user_id=eq.{user_id}"
                    f"&opportunity_id=eq.{opp_id}"
                ),
                headers=_headers("return=minimal"),
                json={"is_notified": True, "notified_at": now},
                timeout=10,
            )
        except Exception as e:
            logger.debug("mark notified skip: %s", e)


# --- Batch Logs ---

def create_batch_log() -> Optional[str]:
    """バッチログを作成し、IDを返す。"""
    resp = requests.post(
        _url("/batch_logs"),
        headers=_headers(),
        json={"status": "running"},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    if isinstance(data, list) and data:
        return data[0]["id"]
    return data.get("id") if isinstance(data, dict) else None


def update_batch_log(log_id: str, **kwargs):
    """バッチログを更新。"""
    requests.patch(
        _url(f"/batch_logs?id=eq.{log_id}"),
        headers=_headers("return=minimal"),
        json=kwargs,
        timeout=10,
    )
