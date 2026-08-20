import { redirect } from 'next/navigation';
import Nav from '@/components/Nav';
import { getSession } from '@/lib/queries';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  // 還沒設定家庭的話,先走一次設定流程
  if (!session.profile.household_id) redirect('/onboarding');

  return (
    <div className="min-h-screen">
      <Nav displayName={session.profile.display_name} />
      <main className="container-app app-scroll pt-5 md:pt-7">{children}</main>
    </div>
  );
}
