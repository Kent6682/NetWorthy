'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { AuthResult } from '@/lib/types';

/**
 * 把 Supabase 的登入錯誤翻成看得懂、而且講得出下一步的訊息。
 *
 * 特別要把「帳號還沒完成 Email 驗證」跟「帳密打錯」分開 ——
 * 兩者都籠統寫成「密碼不正確」的話,使用者會一直重打密碼卻永遠登不進去。
 */
function explainSignInError(error: { message: string; code?: string }): string {
  const msg = error.message.toLowerCase();

  if (error.code === 'email_not_confirmed' || msg.includes('email not confirmed')) {
    return '這個帳號還沒完成 Email 驗證。請到信箱點擊 Supabase 寄出的驗證信,或請管理者關閉 Email 驗證。';
  }

  if (msg.includes('invalid login credentials')) {
    return '登入失敗:Email 或密碼不正確。';
  }

  if (msg.includes('rate limit') || msg.includes('too many')) {
    return '嘗試次數過多,請稍等幾分鐘再試。';
  }

  // 沒對應到的狀況保留原文,不要把真正的原因藏起來
  return `登入失敗:${error.message}`;
}

export async function signIn(_prev: AuthResult | null, formData: FormData): Promise<AuthResult> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) return { error: '請填寫 Email 與密碼' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return { error: explainSignInError(error) };

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function signUp(_prev: AuthResult | null, formData: FormData): Promise<AuthResult> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const displayName = String(formData.get('display_name') ?? '').trim();

  if (!email || !password) return { error: '請填寫 Email 與密碼' };
  if (password.length < 8) return { error: '密碼至少要 8 個字元' };
  if (!displayName) return { error: '請填寫顯示名稱' };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });

  if (error) {
    if (error.message.toLowerCase().includes('already registered')) {
      return { error: '這個 Email 已經註冊過了,請直接登入。' };
    }
    return { error: `註冊失敗:${error.message}` };
  }

  // Email 已被註冊時,Supabase 不會報錯,而是回一個 identities 為空的假使用者
  if (data.user && data.user.identities?.length === 0) {
    return { error: '這個 Email 已經註冊過了,請直接登入。' };
  }

  /*
   * 專案若開著 Email 驗證,signUp 不會給 session。
   * 這時候直接導回首頁只會被擋回登入頁,使用者會以為註冊失敗 ——
   * 所以明講一句「去收信」。
   */
  if (!data.session) {
    return {
      notice:
        '註冊成功!請到信箱點擊驗證信之後再回來登入。(若沒收到,檢查垃圾郵件匣;' +
        '家用情境也可以請管理者到 Supabase 後台關閉 Email 驗證。)',
    };
  }

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}

export async function createHousehold(_prev: AuthResult | null, formData: FormData): Promise<AuthResult> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: '請填寫家庭名稱' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('create_household', { p_name: name });
  if (error) return { error: `建立失敗:${error.message}` };

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function joinHousehold(_prev: AuthResult | null, formData: FormData): Promise<AuthResult> {
  const id = String(formData.get('household_id') ?? '').trim();
  if (!id) return { error: '請填寫邀請碼' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('join_household', { p_household_id: id });
  if (error) return { error: '加入失敗:請確認邀請碼是否正確' };

  revalidatePath('/', 'layout');
  redirect('/');
}
