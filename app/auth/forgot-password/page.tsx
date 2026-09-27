'use client';

import Link from 'next/link';
import { Suspense, useActionState } from 'react';
import { useSearchParams } from 'next/navigation';
import { requestPasswordReset } from '@/app/actions/auth';
import type { AuthResult } from '@/lib/types';

function ExpiredNotice() {
  // 從失效的重設連結被導回來時,說清楚發生了什麼
  const expired = useSearchParams().get('expired');
  if (!expired) return null;
  return (
    <p className="error-text mt-4 text-sm leading-relaxed">
      這個重設連結已經失效、過期,或是在不同的瀏覽器裡打開。請重新申請一次。
    </p>
  );
}

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState<AuthResult | null, FormData>(
    requestPasswordReset,
    null
  );

  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="card p-6 sm:p-7">
          <h1 className="text-lg font-semibold tracking-tight">忘記密碼</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            輸入註冊用的 Email,我們會寄一封重設密碼的信給你。
          </p>

          <Suspense fallback={null}>
            <ExpiredNotice />
          </Suspense>

          <form action={formAction} className="mt-6 space-y-4">
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                className="field"
                autoComplete="email"
                autoCapitalize="off"
                autoCorrect="off"
                required
              />
            </div>

            {state?.error && <p className="error-text text-sm leading-relaxed">{state.error}</p>}

            {state?.notice && (
              <p
                className="rounded-lg p-3 text-sm leading-relaxed"
                style={{ background: 'var(--positive-wash)', color: 'var(--positive)' }}
              >
                {state.notice}
              </p>
            )}

            <button type="submit" className="btn btn-primary w-full" disabled={pending}>
              {pending ? '寄送中…' : '寄出重設信'}
            </button>
          </form>
        </div>

        <Link
          href="/login"
          className="mt-4 block w-full py-2 text-center text-xs"
          style={{ color: 'var(--text-secondary)' }}
        >
          想起來了,回去登入
        </Link>
      </div>
    </main>
  );
}
