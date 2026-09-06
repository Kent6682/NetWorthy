/**
 * 腳本共用的 Supabase 連線與寫入錯誤翻譯。
 *
 * 用的是 service role 金鑰,會繞過 RLS(必須繞過,才能替所有家庭成員算快照)。
 * 這把金鑰只放在 GitHub Secrets,絕對不要進到前端。
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * 延遲建立 client:模組被 import 時(例如單元測試)不該因為缺環境變數就中止行程,
 * 真正要連資料庫時才檢查。
 */
let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      '缺少環境變數 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY。\n' +
        '在 GitHub 上請到 repo 的 Settings → Secrets and variables → Actions 設定這兩個 Secret。'
    );
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/**
 * 把資料庫的寫入錯誤翻譯成看得懂的訊息。
 *
 * 最常見的狀況是 SUPABASE_SERVICE_ROLE_KEY 填成了 publishable / anon 金鑰 ——
 * Postgres 只會回一句「violates row-level security policy」,完全看不出是金鑰的問題。
 */
export function explainWriteError(
  error: { message: string; code?: string },
  what: string
): Error {
  const isRlsBlock =
    error.code === '42501' || /row-level security|violates row-level/i.test(error.message);

  if (!isRlsBlock) return new Error(`${what}失敗:${error.message}`);

  return new Error(
    [
      `${what}失敗:資料庫的 Row Level Security 擋下了寫入。`,
      '',
      '這幾乎一定是 SUPABASE_SERVICE_ROLE_KEY 這個 Secret 填錯了 ——',
      '目前這把金鑰沒有繞過 RLS 的權限,代表它是給瀏覽器用的公開金鑰。',
      '',
      '修正方式:',
      '  1. Supabase 後台 → Settings → API Keys → 「Publishable and secret API keys」分頁',
      '  2. 複製名稱為 default 的 secret key(開頭是 sb_secret_,不是 sb_publishable_)',
      '  3. GitHub repo → Settings → Secrets and variables → Actions',
      '     覆蓋 SUPABASE_SERVICE_ROLE_KEY 這個 Secret',
      '',
      '注意:publishable 與 anon 金鑰受 RLS 限制,不能用在這支腳本 ——',
      '它必須跨所有家庭成員讀寫資料才算得出總資產快照。',
    ].join('\n')
  );
}
