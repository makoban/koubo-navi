# 公募ナビ AI - 試作版 v0.1
import os

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# --- Gemini API ---
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-2.0-flash"
GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models"

# --- Scraping ---
REQUEST_TIMEOUT = 30
USER_AGENT = "KouboNavi/0.1 (bantex.jp; AI procurement matching prototype)"

# Gemini に送るテキストの最大文字数。自治体ページは巨大になることがあるため制限。
MAX_TEXT_LENGTH = 30000

# --- エリア定義 ---
# 各エリアに対し、公募・入札情報が掲載されている行政ページのURLを設定。
# URLは変更される可能性があるため、定期的に確認が必要。
AREAS = {
    "aichi": {
        "name": "愛知県",
        "sources": [
            {
                "name": "愛知県 入札・契約・公売情報",
                "url": "https://www.pref.aichi.jp/life/5/19/",
            },
            {
                "name": "名古屋市 入札・契約",
                "url": "https://www.city.nagoya.jp/jigyou/category/43-0-0-0-0-0-0-0-0-0.html",
            },
            {
                "name": "名古屋法務局 入札・公募",
                "url": "https://houmukyoku.moj.go.jp/nagoya/table/nyuusatsu/all.html",
            },
        ],
    },
    "tokyo": {
        "name": "東京都",
        "sources": [
            {
                "name": "東京都財務局 契約情報",
                "url": "https://www.zaimu.metro.tokyo.lg.jp/keiyaku/",
            },
        ],
    },
    "national": {
        "name": "国（中央省庁）",
        "sources": [
            {
                "name": "愛知労働局 入札情報",
                "url": "https://jsite.mhlw.go.jp/aichi-roudoukyoku/choutatsu_uriharai/nyusatsu.html",
            },
            {
                "name": "名古屋国税局 調達情報",
                "url": "https://www.nta.go.jp/about/organization/nagoya/procurement/chotatsu.htm",
            },
        ],
    },
}
