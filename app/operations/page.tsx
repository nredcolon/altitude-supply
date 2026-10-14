import CatalogApp from "../../components/catalog/catalog-app";
import { requireChatGPTUser } from "../chatgpt-auth";
export const dynamic = "force-dynamic";
export default async function OperationsPage() {
  const user = await requireChatGPTUser("/operations");
  return <CatalogApp displayName={user.displayName} entry="create" />;
}
