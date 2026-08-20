'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export async function signIn(_prev: unknown, formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) return { error: '請填寫 Email 與密碼' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return { error: '登入失敗:Email 或密碼不正確' };

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function signUp(_prev: unknown, formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const displayName = String(formData.get('display_name') ?? '').trim();

  if (!email || !password) return { error: '請填寫 Email 與密碼' };
  if (password.length < 8) return { error: '密碼至少要 8 個字元' };
  if (!displayName) return { error: '請填寫顯示名稱' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });

  if (error) {
    return { error: `註冊失敗:${error.message}` };
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

export async function createHousehold(_prev: unknown, formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: '請填寫家庭名稱' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('create_household', { p_name: name });
  if (error) return { error: `建立失敗:${error.message}` };

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function joinHousehold(_prev: unknown, formData: FormData) {
  const id = String(formData.get('household_id') ?? '').trim();
  if (!id) return { error: '請填寫邀請碼' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('join_household', { p_household_id: id });
  if (error) return { error: '加入失敗:請確認邀請碼是否正確' };

  revalidatePath('/', 'layout');
  redirect('/');
}
