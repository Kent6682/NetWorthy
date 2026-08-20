'use client';

import { useState } from 'react';

export default function InviteCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 瀏覽器不允許剪貼簿時,使用者仍可手動選取
    }
  }

  return (
    <div className="flex items-center gap-2">
      <code
        className="flex-1 truncate rounded-lg px-3 py-2 text-xs"
        style={{ background: 'var(--page-plane)', border: '1px solid var(--hairline-ring)' }}
      >
        {code}
      </code>
      <button type="button" onClick={copy} className="btn btn-secondary shrink-0">
        {copied ? '已複製' : '複製'}
      </button>
    </div>
  );
}
