import CatalogApp from "../../components/catalog/catalog-app";
import { getChatGPTUser } from "../chatgpt-auth";
export const dynamic = "force-dynamic";
export default async function MerchantPage() {
  const user = await getChatGPTUser();
  return (
    <CatalogApp
      displayName={user?.displayName || ""}
      authenticated={Boolean(user)}
      entry="join"
    />
  );
}
