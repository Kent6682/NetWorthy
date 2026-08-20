'use client';

import { useActionState, useState } from 'react';
import { createHousehold, joinHousehold } from '@/app/actions/auth';
import type { AuthResult } from '@/lib/types';

export default function OnboardingPage() {
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const action = mode === 'create' ? createHousehold : joinHousehold;
  const [state, formAction, pending] = useActionState<AuthResult | null, FormData>(action, null);

  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-4 py-10">
      <div className="card w-full max-w-md p-6 sm:p-7">
        <h1 className="text-lg font-semibold tracking-tight">設定你的家庭</h1>
        <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          同一個家庭的成員可以看到彼此的資產,首頁能切換「個人」與「全家」視角。
          每個人只能新增與修改自己名下的資料。
        </p>

        <div
          className="mt-6 flex rounded-lg p-0.5"
          style={{ background: 'var(--surface-sunken)' }}
          role="group"
        >
          {(
            [
              { key: 'create', label: '建立新家庭' },
              { key: 'join', label: '加入既有家庭' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setMode(opt.key)}
              aria-pressed={mode === opt.key}
              className="flex-1 rounded-md px-3 py-2 text-sm transition-all"
              style={{
                background: mode === opt.key ? 'var(--surface-1)' : 'transparent',
                color: mode === opt.key ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: mode === opt.key ? 500 : 400,
                boxShadow: mode === opt.key ? 'var(--shadow-card)' : 'none',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <form action={formAction} className="mt-5 space-y-4">
          {mode === 'create' ? (
            <div>
              <label className="label" htmlFor="name">
                家庭名稱
              </label>
              <input id="name" name="name" className="field" placeholder="例如:我們家" required />
            </div>
          ) : (
            <div>
              <label className="label" htmlFor="household_id">
                邀請碼
              </label>
              <input
                id="household_id"
                name="household_id"
                className="field"
                placeholder="請家人到「設定」複製邀請碼給你"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                required
              />
            </div>
          )}

          {state?.error && <p className="neg text-sm leading-relaxed">{state.error}</p>}

          <button type="submit" className="btn btn-primary w-full" disabled={pending}>
            {pending ? '處理中…' : '完成'}
          </button>
        </form>
      </div>
    </main>
  );
}
