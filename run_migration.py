"""Run SQL migration against Supabase Management API."""
import requests
import sys

ACCESS_TOKEN = "sbp_7fbfb65d1fd7f54581a1490e3d569d2299e75737"
PROJECT_REF = "ypyrjsdotkeyvzequdez"
URL = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
HEADERS = {
    "Authorization": f"Bearer {ACCESS_TOKEN}",
    "Content-Type": "application/json",
}

# Each statement as a separate query
STATEMENTS = [
    # 1. koubo_users
    """CREATE TABLE IF NOT EXISTS koubo_users (
        id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
        company_url TEXT NOT NULL,
        notification_email TEXT,
        notification_threshold INTEGER DEFAULT 40,
        email_notify BOOLEAN DEFAULT true,
        status TEXT DEFAULT 'trial',
        trial_ends_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    )""",
    "ALTER TABLE koubo_users ENABLE ROW LEVEL SECURITY",
    "DO $$ BEGIN CREATE POLICY koubo_users_own ON koubo_users FOR ALL USING (id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$",

    # 2. company_profiles
    """CREATE TABLE IF NOT EXISTS company_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES koubo_users(id) ON DELETE CASCADE,
        company_name TEXT,
        location TEXT,
        business_areas TEXT[],
        services TEXT[],
        strengths TEXT[],
        target_industries TEXT[],
        qualifications TEXT[],
        matching_keywords TEXT[],
        raw_analysis JSONB,
        analyzed_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id)
    )""",
    "ALTER TABLE company_profiles ENABLE ROW LEVEL SECURITY",
    "DO $$ BEGIN CREATE POLICY cp_own ON company_profiles FOR ALL USING (user_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$",

    # 3. user_areas
    """CREATE TABLE IF NOT EXISTS user_areas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES koubo_users(id) ON DELETE CASCADE,
        area_id TEXT NOT NULL,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, area_id)
    )""",
    "ALTER TABLE user_areas ENABLE ROW LEVEL SECURITY",
    "DO $$ BEGIN CREATE POLICY ua_own ON user_areas FOR ALL USING (user_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$",

    # 4. opportunities
    """CREATE TABLE IF NOT EXISTS opportunities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        area_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        title TEXT NOT NULL,
        organization TEXT,
        category TEXT,
        method TEXT,
        deadline DATE,
        budget TEXT,
        summary TEXT,
        requirements TEXT,
        detail_url TEXT,
        scraped_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(source_id, title)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_opp_area_scraped ON opportunities(area_id, scraped_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_opp_deadline ON opportunities(deadline DESC NULLS LAST)",
    "ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY",
    "DO $$ BEGIN CREATE POLICY opp_read ON opportunities FOR SELECT USING (auth.role() = 'authenticated'); EXCEPTION WHEN duplicate_object THEN NULL; END $$",

    # 5. user_opportunities
    """CREATE TABLE IF NOT EXISTS user_opportunities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES koubo_users(id) ON DELETE CASCADE,
        opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
        match_score INTEGER NOT NULL,
        match_reason TEXT,
        risk_notes TEXT,
        recommendation TEXT,
        action_items TEXT[],
        is_notified BOOLEAN DEFAULT false,
        notified_at TIMESTAMPTZ,
        is_bookmarked BOOLEAN DEFAULT false,
        is_dismissed BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, opportunity_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_uo_score ON user_opportunities(user_id, match_score DESC)",
    "CREATE INDEX IF NOT EXISTS idx_uo_notified ON user_opportunities(user_id, is_notified, created_at DESC)",
    "ALTER TABLE user_opportunities ENABLE ROW LEVEL SECURITY",
    "DO $$ BEGIN CREATE POLICY uo_own ON user_opportunities FOR ALL USING (user_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$",

    # 6. notifications
    """CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES koubo_users(id) ON DELETE CASCADE,
        channel TEXT NOT NULL DEFAULT 'email',
        status TEXT NOT NULL DEFAULT 'sent',
        opportunities_count INTEGER DEFAULT 0,
        error_message TEXT,
        sent_at TIMESTAMPTZ DEFAULT NOW()
    )""",
    "ALTER TABLE notifications ENABLE ROW LEVEL SECURITY",
    "DO $$ BEGIN CREATE POLICY notif_own ON notifications FOR SELECT USING (user_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$",

    # 7. batch_logs
    """CREATE TABLE IF NOT EXISTS batch_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at TIMESTAMPTZ,
        users_processed INTEGER DEFAULT 0,
        opportunities_scraped INTEGER DEFAULT 0,
        matches_created INTEGER DEFAULT 0,
        notifications_sent INTEGER DEFAULT 0,
        errors_count INTEGER DEFAULT 0,
        error_details JSONB,
        status TEXT DEFAULT 'running'
    )""",

    # 8. area_sources
    """CREATE TABLE IF NOT EXISTS area_sources (
        id TEXT PRIMARY KEY,
        area_id TEXT NOT NULL,
        area_name TEXT NOT NULL,
        source_name TEXT NOT NULL,
        url TEXT NOT NULL,
        active BOOLEAN DEFAULT true,
        consecutive_failures INTEGER DEFAULT 0,
        last_checked_at TIMESTAMPTZ,
        last_success_at TIMESTAMPTZ,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )""",
    "ALTER TABLE area_sources ENABLE ROW LEVEL SECURITY",
    "DO $$ BEGIN CREATE POLICY as_read ON area_sources FOR SELECT USING (auth.role() = 'authenticated'); EXCEPTION WHEN duplicate_object THEN NULL; END $$",

    # 9. koubo_subscriptions
    """CREATE TABLE IF NOT EXISTS koubo_subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES koubo_users(id) ON DELETE CASCADE,
        stripe_customer_id TEXT NOT NULL,
        stripe_subscription_id TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT 'monthly',
        status TEXT NOT NULL DEFAULT 'active',
        current_period_end TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id)
    )""",
    "ALTER TABLE koubo_subscriptions ENABLE ROW LEVEL SECURITY",
    "DO $$ BEGIN CREATE POLICY sub_own ON koubo_subscriptions FOR SELECT USING (user_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN NULL; END $$",

    # Initial data
    """INSERT INTO area_sources (id, area_id, area_name, source_name, url) VALUES
        ('aichi-pref', 'aichi', '愛知県', '愛知県 入札・契約・公売情報', 'https://www.pref.aichi.jp/life/5/19/'),
        ('aichi-nagoya', 'aichi', '愛知県', '名古屋市 入札・契約', 'https://www.city.nagoya.jp/jigyou/category/43-0-0-0-0-0-0-0-0-0.html'),
        ('aichi-houmukyoku', 'aichi', '愛知県', '名古屋法務局 入札・公募', 'https://houmukyoku.moj.go.jp/nagoya/table/nyuusatsu/all.html'),
        ('tokyo-zaimu', 'tokyo', '東京都', '東京都財務局 契約情報', 'https://www.zaimu.metro.tokyo.lg.jp/keiyaku/'),
        ('tokyo-metro', 'tokyo', '東京都', '東京都 入札・契約', 'https://www.metro.tokyo.lg.jp/tosei/hodohappyo/nyusatsu.html'),
        ('osaka-pref', 'osaka', '大阪府', '大阪府 入札・契約情報', 'https://www.pref.osaka.lg.jp/gyoumu/nyuusatsu/index.html'),
        ('osaka-city', 'osaka', '大阪府', '大阪市 入札・契約情報', 'https://www.city.osaka.lg.jp/zaisei/page/0000006691.html'),
        ('national-aichi-roudou', 'national', '国（中央省庁）', '愛知労働局 入札情報', 'https://jsite.mhlw.go.jp/aichi-roudoukyoku/choutatsu_uriharai/nyusatsu.html'),
        ('national-nagoya-kokuzei', 'national', '国（中央省庁）', '名古屋国税局 調達情報', 'https://www.nta.go.jp/about/organization/nagoya/procurement/chotatsu.htm'),
        ('kanagawa-pref', 'kanagawa', '神奈川県', '神奈川県 入札・契約情報', 'https://www.pref.kanagawa.jp/osirase/nyusatsu.html'),
        ('kanagawa-yokohama', 'kanagawa', '神奈川県', '横浜市 入札・契約情報', 'https://www.city.yokohama.lg.jp/business/nyusatsu/')
    ON CONFLICT (id) DO NOTHING""",
]

def main():
    ok = 0
    fail = 0
    for i, stmt in enumerate(STATEMENTS, 1):
        resp = requests.post(URL, headers=HEADERS, json={"query": stmt}, timeout=30)
        if resp.ok:
            ok += 1
            print(f"  [{i}/{len(STATEMENTS)}] OK")
        else:
            fail += 1
            err = resp.text[:200]
            print(f"  [{i}/{len(STATEMENTS)}] FAIL: {err}")

    print(f"\nMigration: {ok} OK / {fail} FAIL")
    if fail > 0:
        sys.exit(1)

if __name__ == "__main__":
    main()
