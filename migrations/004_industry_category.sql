-- 004: 業種カテゴリ追加
-- 案件とユーザーの業種マッチングをSQLベースで行うための分類カラム

-- opportunities に業種カテゴリ追加（10分類の1つ）
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS industry_category TEXT;
CREATE INDEX IF NOT EXISTS idx_opp_industry ON opportunities (industry_category);

-- company_profiles に業種カテゴリ配列追加（複数業種対応）
ALTER TABLE company_profiles ADD COLUMN IF NOT EXISTS industry_categories TEXT[] DEFAULT '{}';
