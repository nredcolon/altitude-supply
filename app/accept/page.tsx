import AcceptInvitation from "../../components/catalog/accept-invitation";
import { getChatGPTUser } from "../chatgpt-auth";
export const dynamic = "force-dynamic";
export default async function AcceptPage() {
  const user = await getChatGPTUser();
  return (
    <AcceptInvitation
      authenticated={Boolean(user)}
      displayName={user?.displayName || ""}
    />
  );
}
