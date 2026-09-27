'use client';

import { useActionState } from 'react';
import { updatePassword } from '@/app/actions/auth';
import type { AuthResult } from '@/lib/types';

/**
 * 從重設信點進來、經過 /auth/callback 換成登入狀態之後,在這裡設新密碼。
 * 沒有登入狀態時送出會得到「連結已失效」的說明,不會默默失敗。
 */
export default function ResetPasswordPage() {
  const [state, formAction, pending] = useActionState<AuthResult | null, FormData>(
    updatePassword,
    null
  );

  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="card p-6 sm:p-7">
          <h1 className="text-lg font-semibold tracking-tight">設定新密碼</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            設定好之後會直接登入。
          </p>

          <form action={formAction} className="mt-6 space-y-4">
            <div>
              <label className="label" htmlFor="password">
                新密碼
              </label>
              <input
                id="password"
                name="password"
                type="password"
                className="field"
                autoComplete="new-password"
                minLength={8}
                required
              />
              <p className="mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                至少 8 個字元
              </p>
            </div>

            <div>
              <label className="label" htmlFor="confirm">
                再輸入一次
              </label>
              <input
                id="confirm"
                name="confirm"
                type="password"
                className="field"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>

            {state?.error && <p className="error-text text-sm leading-relaxed">{state.error}</p>}

            <button type="submit" className="btn btn-primary w-full" disabled={pending}>
              {pending ? '儲存中…' : '儲存新密碼'}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
