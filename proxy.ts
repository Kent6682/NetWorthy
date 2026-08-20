import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/session';

export default async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * 略過靜態檔案與圖片,其餘所有路徑都經過 session 檢查
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
