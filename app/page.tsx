import CatalogApp from "../components/catalog/catalog-app";
import { requireChatGPTUser } from "./chatgpt-auth";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await requireChatGPTUser("/");
  return <CatalogApp displayName={user.displayName} />;
}
