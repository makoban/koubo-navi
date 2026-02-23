"""公募ナビAI - メール通知モジュール（Resend API）"""

import json
import logging
from datetime import datetime, timezone

import requests

import config
import db

logger = logging.getLogger(__name__)


def send_notification(user: dict, matches: list[dict], tier: str = "free", total_count: int = 0) -> bool:
    """ユーザーにマッチング結果メールを送信する。

    Args:
        user: koubo_users レコード。
        matches: 通知対象のマッチング結果。
        tier: "paid" or "free"。
        total_count: フィルタ前の全件数。

    Returns:
        送信成功なら True。
    """
    if not matches:
        return False

    email = user.get("notification_email")
    if not email:
        logger.warning("通知先メールなし: user=%s", user.get("id"))
        return False

    if not config.RESEND_API_KEY:
        logger.warning("RESEND_API_KEY 未設定のため通知スキップ")
        return False

    # メール本文を組み立て
    html_body = _build_email_html(matches, tier=tier, total_count=total_count)
    subject = f"【公募ナビAI】本日の新着マッチング TOP {len(matches)}"

    try:
        resp = requests.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {config.RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "from": config.FROM_EMAIL,
                "to": [email],
                "subject": subject,
                "html": html_body,
            },
            timeout=15,
        )
        resp.raise_for_status()
        logger.info("メール送信成功: %s (%d件)", email, len(matches))
        return True

    except Exception as exc:
        logger.error("メール送信失敗: %s: %s", email, exc)
        return False


def notify_user(user: dict) -> int:
    """ユーザーの未通知マッチを取得して通知する。

    Returns:
        通知した案件数。
    """
    user_id = user["id"]
    threshold = user.get("notification_threshold", config.DEFAULT_MATCH_THRESHOLD)

    matches = db.get_unnotified_matches(user_id, threshold)
    if not matches:
        return 0

    # ティア別制限: 無料ユーザーはTOP10のみ
    tier = db.get_user_tier(user)
    max_in_email = 100 if tier == "paid" else 10
    total_matches = len(matches)
    matches_to_send = matches[:max_in_email]

    success = send_notification(user, matches_to_send, tier=tier, total_count=total_matches)

    if success:
        opp_ids = [m["opportunity_id"] for m in matches]
        db.mark_as_notified(user_id, opp_ids)

        # notifications テーブルに記録
        _log_notification(user_id, len(matches), "sent")
    else:
        _log_notification(user_id, len(matches), "failed")

    return len(matches) if success else 0


def _log_notification(user_id: str, count: int, status: str):
    """通知ログを DB に記録する。"""
    try:
        requests.post(
            f"{config.SUPABASE_URL}/rest/v1/notifications",
            headers={
                "apikey": config.SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {config.SUPABASE_SERVICE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            json={
                "user_id": user_id,
                "channel": "email",
                "status": status,
                "opportunities_count": count,
            },
            timeout=10,
        )
    except Exception as exc:
        logger.debug("通知ログ保存失敗: %s", exc)


def _build_email_html(matches: list[dict], tier: str = "free", total_count: int = 0) -> str:
    """マッチング結果のHTMLメールを生成する（ランキング付き）。"""
    rows = []
    for idx, m in enumerate(matches, start=1):
        opp = m.get("opportunities", {}) or {}
        score = m.get("match_score", 0)
        rank = m.get("rank_position", idx)
        title = opp.get("title", m.get("title", "不明"))
        org = opp.get("organization", "不明")
        category = opp.get("category", "")
        deadline = opp.get("deadline", "")
        reason = m.get("match_reason", "")
        detail_url = opp.get("detail_url", "")
        recommendation = m.get("recommendation", "")

        # スコアバッジ色
        if score >= 80:
            badge_color = "#22c55e"
        elif score >= 60:
            badge_color = "#f59e0b"
        else:
            badge_color = "#94a3b8"

        # ランキングバッジ色
        if rank <= 3:
            rank_color = "#ffd700"
        elif rank <= 10:
            rank_color = "#c9a96e"
        else:
            rank_color = "#94a3b8"

        link_html = ""
        if detail_url:
            link_html = f'<a href="{detail_url}" style="color:#f59e0b;">詳細を見る</a>'

        rows.append(f"""
        <tr>
          <td style="padding:12px;border-bottom:1px solid #333;">
            <span style="color:{rank_color};font-size:16px;font-weight:bold;margin-right:8px;">#{rank}</span>
            <span style="background:{badge_color};color:#fff;padding:2px 8px;border-radius:4px;font-size:13px;font-weight:bold;">{score}%</span>
            <span style="margin-left:8px;color:#94a3b8;font-size:12px;">{recommendation}</span>
            <div style="margin-top:6px;font-size:15px;font-weight:bold;color:#f1f5f9;">{title}</div>
            <div style="margin-top:3px;font-size:13px;color:#94a3b8;">{org} / {category}</div>
            {f'<div style="margin-top:3px;font-size:12px;color:#f59e0b;">締切: {deadline}</div>' if deadline else ''}
            <div style="margin-top:4px;font-size:13px;color:#cbd5e1;">{reason}</div>
            {f'<div style="margin-top:6px;">{link_html}</div>' if link_html else ''}
          </td>
        </tr>""")

    # 無料ユーザー向けアップグレードCTA
    upgrade_html = ""
    if tier == "free" and total_count > len(matches):
        remaining = total_count - len(matches)
        upgrade_html = f"""
    <div style="background:#1a1f35;border-radius:8px;padding:20px;text-align:center;margin-top:16px;border:1px solid #c9a96e33;">
      <p style="color:#c9a96e;font-size:14px;font-weight:bold;margin:0 0 8px;">
        他に {remaining}件 のマッチング案件があります
      </p>
      <p style="color:#94a3b8;font-size:13px;margin:0 0 12px;">
        有料プランなら最大100件のランキングを確認できます
      </p>
      <a href="https://koubo-navi.bantex.jp?upgrade=1" style="display:inline-block;background:#c9a96e;color:#0a0e1a;padding:10px 24px;border-radius:8px;font-weight:bold;text-decoration:none;font-size:13px;">
        プランをアップグレード
      </a>
    </div>"""

    today = datetime.now(timezone.utc).strftime("%Y年%m月%d日")

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">
    <div style="text-align:center;margin-bottom:24px;">
      <h1 style="color:#c9a96e;font-size:22px;margin:0;">公募ナビAI</h1>
      <p style="color:#f1f5f9;font-size:16px;font-weight:bold;margin:12px 0 4px;">本日の新着マッチング TOP {len(matches)}</p>
      <p style="color:#94a3b8;font-size:13px;margin:0;">{today}</p>
    </div>

    <table style="width:100%;border-collapse:collapse;background:#1a1f35;border-radius:8px;overflow:hidden;">
      {''.join(rows)}
    </table>

    {upgrade_html}

    <div style="background:#1a1f3588;border-radius:8px;padding:12px 16px;margin-top:16px;text-align:center;">
      <p style="color:#94a3b8;font-size:12px;margin:0;">💡 案件をクリックして「AI詳細分析」で応募のヒントが得られます</p>
    </div>

    <div style="text-align:center;margin-top:24px;">
      <a href="https://koubo-navi.bantex.jp" style="display:inline-block;background:#c9a96e;color:#0a0e1a;padding:12px 32px;border-radius:8px;font-weight:bold;text-decoration:none;font-size:15px;">
        ダッシュボードで確認する
      </a>
    </div>

    <div style="text-align:center;margin-top:32px;color:#64748b;font-size:11px;">
      <p>公募ナビAI by bantex</p>
      <p>通知設定はダッシュボードから変更できます</p>
    </div>
  </div>
</body>
</html>"""
