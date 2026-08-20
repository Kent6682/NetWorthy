import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * 在 Server Component / Server Action 裡使用的 Supabase client。
 * 會自動帶上使用者的登入 cookie,所有查詢都受 RLS 保護。
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // 在 Server Component 內呼叫 set 會拋錯,由 middleware 負責更新 session
          }
        },
      },
    }
  );
}
