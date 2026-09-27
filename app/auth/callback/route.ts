import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/**
 * Email 連結的落地點:把信裡的一次性憑證換成登入狀態,再導到 next。
 *
 * 支援兩種連結格式:
 *   ?code=...                     Supabase 預設信件範本(PKCE)。要在「申請重設的同一個瀏覽器」
 *                                  打開才換得成功 —— 驗證碼的另一半存在那個瀏覽器的 cookie 裡。
 *   ?token_hash=...&type=recovery 改過的信件範本。任何瀏覽器都能開,手機上用郵件 App
 *                                  內建瀏覽器點開也沒問題,較推薦(設定方式見 README)。
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;

  // 只接受站內路徑,避免被拿來當成跳轉到外部網站的跳板
  const nextParam = searchParams.get('next') ?? '/';
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';

  const supabase = await createClient();

  let ok = false;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  if (!ok) {
    return NextResponse.redirect(`${origin}/auth/forgot-password?expired=1`);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
