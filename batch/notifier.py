"""公募ナビAI - メール通知モジュール v3.0（Resend API）

業種カテゴリマッチの新着案件を通知。
各案件のAI詳細分析を生成 or キャッシュ取得し、メールにインライン表示。
"""

import json
import logging
from datetime import datetime, timezone

import requests

import config
import db
from gemini_client import call_gemini, parse_json_response

logger = logging.getLogger(__name__)


def notify_user(user: dict) -> int:
    """ユーザーの業種マッチ新着案件を取得して通知する。

    Returns:
        通知した案件数。
    """
    user_id = user["id"]

    # ユーザーの業種カテゴリを取得
    industry_cats = db.get_user_industry_categories(user_id)
    if not industry_cats:
        logger.info("業種カテゴリ未設定: %s", user_id)
        return 0

    # 業種マッチの新着案件を取得（過去24時間）
    new_opps = db.get_new_opportunities_by_industry(industry_cats, since_hours=24)
    if not new_opps:
        return 0

    # ティア判定
    tier = db.get_user_tier(user)
    max_in_email = 20 if tier == "paid" else 5

    # プロフィール取得（AI分析用）
    profile = db.get_user_profile(user_id)
    if not profile:
        logger.warning("プロフィール未設定: %s", user_id)
        return 0

    # 各案件のAI詳細分析を生成 or キャッシュ取得
    analyzed_opps = []
    for opp in new_opps[:max_in_email]:
        try:
            analysis = db.get_cached_analysis(user_id, opp["id"])
            if not analysis:
                analysis = _generate_analysis(profile, opp)
                if analysis:
                    db.save_detailed_analysis(user_id, opp["id"], analysis)
            analyzed_opps.append({"opportunity": opp, "analysis": analysis})
        except Exception as exc:
            logger.debug("分析失敗 %s: %s", opp["id"], exc)
            analyzed_opps.append({"opportunity": opp, "analysis": None})

    if not analyzed_opps:
        return 0

    # メール送信
    success = _send_notification(user, analyzed_opps, tier=tier, total_count=len(new_opps))

    if success:
        _log_notification(user_id, len(analyzed_opps), "sent")
    else:
        _log_notification(user_id, len(analyzed_opps), "failed")

    return len(analyzed_opps) if success else 0


def _generate_analysis(profile: dict, opp: dict) -> dict | None:
    """案件のAI詳細分析をGeminiで生成する。"""
    prompt = f"""あなたは公募案件と企業のマッチング分析の専門家です。
以下の案件情報と企業プロフィールを照らし合わせて、詳細な分析をJSON形式で出力してください。

【案件情報】
タイトル: {opp.get('title', '不明')}
カテゴリ: {opp.get('category', '不明')}
発注機関: {opp.get('organization', '不明')}
業種: {opp.get('industry_category', '不明')}
締切: {opp.get('deadline', '不明')}
予算: {opp.get('budget', '不明')}
要約: {opp.get('detailed_summary') or opp.get('summary', '不明')}

【企業プロフィール】
会社名: {profile.get('company_name', '不明')}
事業分野: {', '.join(profile.get('business_areas', []))}
サービス: {', '.join(profile.get('services', []))}
強み: {', '.join(profile.get('strengths', []))}

出力:
{{
  "summary": "総合評価（150文字程度）",
  "match_points": ["マッチポイント1", "ポイント2", "ポイント3"],
  "concerns": ["懸念点1", "懸念点2"],
  "actions": ["アクション1", "アクション2", "アクション3"]
}}"""

    try:
        response = call_gemini(prompt, json_mode=True, max_tokens=2048)
        result = parse_json_response(response)
        if isinstance(result, dict):
            return result
    except Exception as exc:
        logger.debug("Gemini分析失敗: %s", exc)
    return None


def _send_notification(
    user: dict,
    analyzed_opps: list[dict],
    tier: str = "free",
    total_count: int = 0,
) -> bool:
    """メール送信。"""
    email = user.get("notification_email")
    if not email:
        logger.warning("通知先メールなし: user=%s", user.get("id"))
        return False

    if not config.RESEND_API_KEY:
        logger.warning("RESEND_API_KEY 未設定のため通知スキップ")
        return False

    html_body = _build_email_html(analyzed_opps, tier=tier, total_count=total_count)
    subject = f"【公募ナビAI】本日の新着案件 {len(analyzed_opps)}件"

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
        logger.info("メール送信成功: %s (%d件)", email, len(analyzed_opps))
        return True
    except Exception as exc:
        logger.error("メール送信失敗: %s: %s", email, exc)
        return False


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


def _build_email_html(
    analyzed_opps: list[dict],
    tier: str = "free",
    total_count: int = 0,
) -> str:
    """新着案件 + AI詳細分析のHTMLメールを生成する。"""
    rows = []
    for item in analyzed_opps:
        opp = item.get("opportunity", {})
        analysis = item.get("analysis") or {}

        title = opp.get("title", "不明")
        org = opp.get("organization", "不明")
        category = opp.get("industry_category", opp.get("category", ""))
        deadline = opp.get("deadline", "")
        budget = opp.get("budget", "")
        difficulty = opp.get("difficulty", "")
        summary = opp.get("detailed_summary") or opp.get("summary", "")
        detail_url = opp.get("detail_url", "")

        # AI分析結果
        ai_summary = analysis.get("summary", "")
        match_points = analysis.get("match_points", [])
        concerns = analysis.get("concerns", [])
        actions = analysis.get("actions", [])

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

        # AI分析セクション
        ai_html = ""
        if ai_summary:
            ai_html += f'<div style="margin-top:10px;padding:10px;background:rgba(0,0,0,0.2);border-radius:6px;border-left:3px solid #c9a96e;">'
            ai_html += f'<div style="font-size:13px;color:#f1f5f9;line-height:1.7;margin-bottom:8px;">{ai_summary}</div>'

            if match_points:
                ai_html += '<div style="margin-bottom:6px;">'
                for pt in match_points[:3]:
                    ai_html += f'<div style="font-size:12px;color:#4ade80;line-height:1.6;">✓ {pt}</div>'
                ai_html += '</div>'

            if concerns:
                for c in concerns[:2]:
                    ai_html += f'<div style="font-size:12px;color:#fbbf24;line-height:1.6;">⚠ {c}</div>'

            if actions:
                ai_html += '<div style="margin-top:6px;">'
                for i, a in enumerate(actions[:3], 1):
                    ai_html += f'<div style="font-size:12px;color:#94a3b8;line-height:1.6;">{i}. {a}</div>'
                ai_html += '</div>'

            ai_html += '</div>'

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
            {ai_html}
            {f'<div style="margin-top:8px;">{link_html}</div>' if link_html else ''}
          </td>
        </tr>""")

    # 無料ユーザー向けアップグレードCTA
    upgrade_html = ""
    if tier == "free" and total_count > len(analyzed_opps):
        remaining = total_count - len(analyzed_opps)
        upgrade_html = f"""
    <div style="background:#1a1f35;border-radius:8px;padding:20px;text-align:center;margin-top:16px;border:1px solid #c9a96e33;">
      <p style="color:#c9a96e;font-size:14px;font-weight:bold;margin:0 0 8px;">
        他に {remaining}件 の業種マッチ案件があります
      </p>
      <p style="color:#94a3b8;font-size:13px;margin:0 0 12px;">
        有料プランなら最大20件の新着案件をメールで受け取れます
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
      <p style="color:#f1f5f9;font-size:16px;font-weight:bold;margin:12px 0 4px;">本日の新着案件 {len(analyzed_opps)}件</p>
      <p style="color:#94a3b8;font-size:13px;margin:0;">{today} / 業種マッチ</p>
    </div>

    <table style="width:100%;border-collapse:collapse;background:#1a1f35;border-radius:8px;overflow:hidden;">
      {''.join(rows)}
    </table>

    {upgrade_html}

    <div style="text-align:center;margin-top:24px;">
      <a href="https://koubo-navi.bantex.jp" style="display:inline-block;background:#c9a96e;color:#0a0e1a;padding:12px 32px;border-radius:8px;font-weight:bold;text-decoration:none;font-size:15px;">
        ダッシュボードで確認する
      </a>
    </div>

    <div style="text-align:center;margin-top:32px;color:#64748b;font-size:11px;">
      <p>公募ナビAI v3.0 by bantex</p>
      <p>通知設定はダッシュボードから変更できます</p>
    </div>
  </div>
</body>
</html>"""
