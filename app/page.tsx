import SupplyApp from './supply-app';
import { requireChatGPTUser } from './chatgpt-auth';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await requireChatGPTUser('/');
  return <SupplyApp displayName={user.fullName || '我的工作空间'} />;
}
