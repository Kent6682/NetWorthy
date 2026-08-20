'use client';

import { useActionState, useState } from 'react';
import { signIn, signUp } from '@/app/actions/auth';

export default function LoginPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const action = mode === 'signin' ? signIn : signUp;
  const [state, formAction, pending] = useActionState(action, null as { error?: string } | null);

  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="card p-6 sm:p-7">
          <h1 className="text-lg font-semibold tracking-tight">資產追蹤</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {mode === 'signin' ? '登入你的帳號' : '建立新帳號'}
          </p>

          <form action={formAction} className="mt-6 space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="label" htmlFor="display_name">
                  顯示名稱
                </label>
                <input
                  id="display_name"
                  name="display_name"
                  className="field"
                  placeholder="例如:Kent"
                  autoComplete="name"
                  required
                />
              </div>
            )}

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

            <div>
              <label className="label" htmlFor="password">
                密碼
              </label>
              <input
                id="password"
                name="password"
                type="password"
                className="field"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                minLength={8}
                required
              />
              {mode === 'signup' && (
                <p className="mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                  至少 8 個字元
                </p>
              )}
            </div>

            {state?.error && <p className="neg text-sm leading-relaxed">{state.error}</p>}

            <button type="submit" className="btn btn-primary w-full" disabled={pending}>
              {pending ? '處理中…' : mode === 'signin' ? '登入' : '註冊'}
            </button>
          </form>
        </div>

        <button
          type="button"
          onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          className="mt-4 w-full py-2 text-center text-xs"
          style={{ color: 'var(--text-secondary)' }}
        >
          {mode === 'signin' ? '還沒有帳號?建立一個' : '已經有帳號了,去登入'}
        </button>
      </div>
    </main>
  );
}
