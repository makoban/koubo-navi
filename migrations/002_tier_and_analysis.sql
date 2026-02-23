-- 002: ティア制限 + AI詳細分析 + テキスト入力対応
-- 実行: Supabase SQL Editor で実行

-- koubo_users: company_url をオプショナルに、company_text 追加
ALTER TABLE koubo_users ALTER COLUMN company_url DROP NOT NULL;
ALTER TABLE koubo_users ALTER COLUMN company_url SET DEFAULT '';
ALTER TABLE koubo_users ADD COLUMN IF NOT EXISTS company_text TEXT;
ALTER TABLE koubo_users ADD COLUMN IF NOT EXISTS initial_screening_done BOOLEAN DEFAULT false;
ALTER TABLE koubo_users ADD COLUMN IF NOT EXISTS initial_screening_at TIMESTAMPTZ;

-- user_opportunities: ランキング + AI詳細分析
ALTER TABLE user_opportunities ADD COLUMN IF NOT EXISTS rank_position INTEGER;
ALTER TABLE user_opportunities ADD COLUMN IF NOT EXISTS detailed_analysis JSONB;
ALTER TABLE user_opportunities ADD COLUMN IF NOT EXISTS analysis_requested_at TIMESTAMPTZ;
ALTER TABLE user_opportunities ADD COLUMN IF NOT EXISTS analysis_completed_at TIMESTAMPTZ;

-- インデックス
CREATE INDEX IF NOT EXISTS idx_uo_rank
  ON user_opportunities(user_id, created_at DESC, match_score DESC);
CREATE INDEX IF NOT EXISTS idx_uo_detailed
  ON user_opportunities(user_id, opportunity_id) WHERE detailed_analysis IS NOT NULL;
