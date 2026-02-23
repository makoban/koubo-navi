"""公募ナビAI - バッチ処理設定"""

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

# --- Supabase ---
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://ypyrjsdotkeyvzequdez.supabase.co")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# --- Resend (Email) ---
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
FROM_EMAIL = os.environ.get("FROM_EMAIL", "公募ナビAI <noreply@bantex.jp>")

# --- Scraping ---
REQUEST_TIMEOUT = 30
USER_AGENT = "KouboNavi/1.0 (bantex.jp; AI procurement matching)"
MAX_TEXT_LENGTH = 30000

# --- Matching ---
BATCH_SIZE = 15  # Gemini 1回に送る案件数の上限
DEFAULT_MATCH_THRESHOLD = 40  # 通知する最低スコア
