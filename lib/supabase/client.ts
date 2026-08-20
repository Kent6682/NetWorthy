import { createBrowserClient } from '@supabase/ssr';

/** 在 Client Component 裡使用的 Supabase client */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
