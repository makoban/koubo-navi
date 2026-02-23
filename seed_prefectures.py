#!/usr/bin/env python3
"""全47都道府県の入札情報ソースを area_sources テーブルに一括登録するスクリプト"""

import json
import os
import sys

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://ypyrjsdotkeyvzequdez.supabase.co")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

if not SUPABASE_SERVICE_KEY:
    print("ERROR: SUPABASE_SERVICE_KEY 環境変数を設定してください")
    sys.exit(1)


def headers():
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation",
    }


def main():
    # prefectures.json を読み込み
    script_dir = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(script_dir, "prefectures.json"), encoding="utf-8") as f:
        prefectures = json.load(f)

    print(f"=== {len(prefectures)} 都道府県を area_sources に登録 ===\n")

    success = 0
    skipped = 0
    failed = 0

    for pref in prefectures:
        record = {
            "id": f"{pref['area_id']}-pref",
            "area_id": pref["area_id"],
            "area_name": pref["area_name"],
            "source_name": pref["source_name"],
            "url": pref["url"],
            "active": True,
            "consecutive_failures": 0,
        }

        try:
            resp = requests.post(
                f"{SUPABASE_URL}/rest/v1/area_sources",
                headers=headers(),
                json=record,
                timeout=15,
            )

            if resp.status_code == 201 or resp.status_code == 200:
                success += 1
                print(f"  OK  {pref['area_name']} ({pref['area_id']})")
            elif resp.status_code == 409:
                skipped += 1
                print(f"  SKIP  {pref['area_name']} (既に存在)")
            else:
                failed += 1
                print(f"  FAIL  {pref['area_name']} - HTTP {resp.status_code}: {resp.text[:100]}")
        except Exception as e:
            failed += 1
            print(f"  FAIL  {pref['area_name']} - {e}")

    print(f"\n=== 結果: {success} 登録 / {skipped} スキップ / {failed} 失敗 ===")


if __name__ == "__main__":
    main()
