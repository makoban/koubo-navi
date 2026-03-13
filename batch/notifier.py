"""公募ナビAI - メール通知モジュール v3.4（Resend API）

業種カテゴリマッチの新着案件を通知。
案件の基本情報のみをシンプルに表示（AI分析なし）。
無料ユーザー（tier="free"）はメール送信をスキップ。
"""

import logging
from datetime import datetime, timezone

import requests

import config
import db

logger = logging.getLogger(__name__)


def notify_user(user: dict) -> int:
    """ユーザーの業種マッチ新着案件を取得して通知する。

    Returns:
        通知した案件数。
    """
    user_id = user["id"]

    # ティア判定: 無料ユーザーはメール送信をスキップ
    tier = db.get_user_tier(user)
    if tier == "free":
        logger.info("無料ユーザーのためメール通知スキップ: %s", user_id)
        return 0

    # ユーザーの業種カテゴリを取得
    industry_cats = db.get_user_industry_categories(user_id)
    if not industry_cats:
        logger.info("業種カテゴリ未設定: %s", user_id)
        return 0

    # ユーザーのエリアを取得
    user_areas = db.get_user_areas(user_id)

    # 業種マッチの新着案件を取得（過去72時間、エリア絞り込み）
    # 72hに拡大: バッチ未実行日があっても案件を取りこぼさない
    logger.info("業種マッチ検索: user=%s, cats=%s, areas=%s", user_id, industry_cats, user_areas)
    new_opps = db.get_new_opportunities_by_industry(industry_cats, since_hours=72, area_ids=user_areas or None)

    # ダッシュボードと同じフィルターを適用
    BAD_URLS = ["/pps-web-biz/UAA01/OAA0101", "/all.html"]
    new_opps = [
        opp for opp in new_opps
        if opp.get("detail_url")
        and not any(bad in opp["detail_url"] for bad in BAD_URLS)
    ]

    # 通知済み案件を除外（72h化による重複送信を防止）
    notified_ids = db.get_notified_opportunity_ids(user_id)
    if notified_ids:
        before_count = len(new_opps)
        new_opps = [opp for opp in new_opps if opp["id"] not in notified_ids]
        if before_count != len(new_opps):
            logger.info("通知済み除外: %d件 → %d件 (user=%s)", before_count, len(new_opps), user_id)

    if not new_opps:
        logger.info("新着マッチ案件なし: user=%s", user_id)
        return 0
    logger.info("新着マッチ案件: %d件 (user=%s)", len(new_opps), user_id)

    # 有料ユーザーは最大20件
    max_in_email = 20
    opps_to_send = new_opps[:max_in_email]

    if not opps_to_send:
        return 0

    # メール送信
    success = _send_notification(user, opps_to_send, total_count=len(new_opps))

    if success:
        _log_notification(user_id, len(opps_to_send), "sent")
        logger.info("通知完了: user=%s, %d件送信", user_id, len(opps_to_send))
        # 通知済みフラグを更新（送信成功後のみ）
        sent_ids = [opp["id"] for opp in opps_to_send if opp.get("id")]
        if sent_ids:
            db.mark_as_notified(user_id, sent_ids)
    else:
        _log_notification(user_id, len(opps_to_send), "failed")
        logger.error("通知失敗: user=%s, %d件のメール送信に失敗", user_id, len(opps_to_send))

    return len(opps_to_send) if success else 0


def _send_notification(
    user: dict,
    opps: list[dict],
    total_count: int = 0,
) -> bool:
    """メール送信。"""
    # notification_email が未設定の場合は email にフォールバック
    email = user.get("notification_email") or user.get("email")
    if not email:
        logger.warning("通知先メールなし: user=%s", user.get("id"))
        return False

    if not config.RESEND_API_KEY:
        logger.warning("RESEND_API_KEY 未設定のため通知スキップ")
        return False

    html_body = _build_email_html(opps, total_count=total_count)
    subject = f"【公募ナビAI】本日の新着案件 {len(opps)}件"

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
            timeout=30,
        )
        if not resp.ok:
            logger.error("Resend API エラー: status=%d body=%s", resp.status_code, resp.text[:500])
        resp.raise_for_status()
        logger.info("メール送信成功: %s (%d件)", email, len(opps))
        return True
    except Exception as exc:
        logger.error("メール送信失敗: %s: %s", email, exc)
        return False


def _log_notification(user_id: str, count: int, status: str):
    """通知ログを DB に記録する。"""
    try:
        resp = requests.post(
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
        if not resp.ok:
            # DBへの通知ログ保存失敗は警告として記録（サイレント失敗を防止）
            logger.warning(
                "通知ログ保存失敗 user=%s: status=%d body=%s",
                user_id, resp.status_code, resp.text[:200],
            )
    except Exception as exc:
        logger.warning("通知ログ保存失敗 user=%s: %s", user_id, exc)


def _build_email_html(
    opps: list[dict],
    total_count: int = 0,
) -> str:
    """新着案件の基本情報のみのHTMLメールを生成する（AI分析なし）。"""
    rows = []
    for opp in opps:
        title = opp.get("title") or "不明"
        org = opp.get("organization") or "不明"
        category = opp.get("industry_category") or opp.get("category") or ""
        deadline = opp.get("deadline") or ""
        budget = opp.get("budget") or ""
        difficulty = opp.get("difficulty") or ""
        summary = opp.get("detailed_summary") or opp.get("summary") or ""
        detail_url = opp.get("detail_url", "")

        # 業種カテゴリバッジ色
        cat_color = "#c9a96e"

        # 難易度バッジ
        diff_html = ""
        if difficulty:
            diff_color = "#f87171" if difficulty == "高" else "#fbbf24" if difficulty == "中" else "#4ade80"
            diff_html = f'<span style="background:rgba(0,0,0,0.3);color:{diff_color};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">難易度: {difficulty}</span>'

        link_html = ""
        if detail_url:
            link_html = f'<a href="{detail_url}" style="color:#c9a96e;font-size:13px;">詳細ページ →</a>'

        rows.append(f"""
        <tr>
          <td style="padding:16px;border-bottom:1px solid #333;">
            <span style="background:rgba(201,169,110,0.15);color:{cat_color};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">{category}</span>
            {diff_html}
            <div style="margin-top:8px;font-size:15px;font-weight:bold;color:#f1f5f9;">{title}</div>
            <div style="margin-top:3px;font-size:13px;color:#94a3b8;">{org}</div>
            <div style="margin-top:4px;font-size:12px;display:flex;gap:12px;flex-wrap:wrap;">
              {f'<span style="color:#fbbf24;">締切: {deadline}</span>' if deadline else ''}
              {f'<span style="color:#4ade80;">{budget}</span>' if budget else ''}
            </div>
            {f'<div style="margin-top:6px;font-size:13px;color:#cbd5e1;line-height:1.6;">{summary[:150]}</div>' if summary else ''}
            {f'<div style="margin-top:8px;">{link_html}</div>' if link_html else ''}
          </td>
        </tr>""")

    today = datetime.now(timezone.utc).strftime("%Y年%m月%d日")

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">
    <div style="text-align:center;margin-bottom:24px;">
      <h1 style="color:#c9a96e;font-size:22px;margin:0;">公募ナビAI</h1>
      <p style="color:#f1f5f9;font-size:16px;font-weight:bold;margin:12px 0 4px;">本日の新着案件 {len(opps)}件</p>
      <p style="color:#94a3b8;font-size:13px;margin:0;">{today} / 業種マッチ</p>
    </div>

    <table style="width:100%;border-collapse:collapse;background:#1a1f35;border-radius:8px;overflow:hidden;">
      {''.join(rows)}
    </table>

    <div style="text-align:center;margin-top:24px;">
      <a href="https://koubo-navi.bantex.jp" style="display:inline-block;background:#c9a96e;color:#0a0e1a;padding:12px 32px;border-radius:8px;font-weight:bold;text-decoration:none;font-size:15px;">
        ダッシュボードで確認する
      </a>
    </div>

    <div style="text-align:center;margin-top:32px;color:#64748b;font-size:11px;">
      <p>公募ナビAI v3.5 by bantex</p>
      <p>通知設定はダッシュボードから変更できます</p>
    </div>
  </div>
</body>
</html>"""
