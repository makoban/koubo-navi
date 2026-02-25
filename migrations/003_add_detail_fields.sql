-- 003: 詳細ページ取得フィールド追加
-- 案件の詳細ページからGeminiで抽出した情報を保存するカラム

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS published_date DATE;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS difficulty TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS detailed_summary TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS detail_fetched_at TIMESTAMPTZ;

-- 詳細未取得の案件を効率的に取得するためのインデックス
CREATE INDEX IF NOT EXISTS idx_opp_detail_fetched ON opportunities (detail_fetched_at NULLS FIRST) WHERE detail_url IS NOT NULL;
