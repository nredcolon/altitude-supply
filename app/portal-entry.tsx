import { env } from "cloudflare:workers";
import { redirect } from "next/navigation";
import { getChatGPTUser } from "./chatgpt-auth";
import {
  platformRow,
  sessionFor,
  type Portal,
  type PortalSession,
} from "../lib/catalog/platform";
import PortalLogin from "../components/catalog/portal-login";
import CatalogApp from "../components/catalog/catalog-app";

export async function PortalEntry({
  portal,
  login = false,
}: {
  portal: Portal;
  login?: boolean;
}) {
  const user = await getChatGPTUser();
  if (!user && !login) redirect(`/${portal}/login`);
  let session: PortalSession = { status: "anonymous" };
  if (user) {
    try {
      if (!env.DB) throw new Error("平台暂不可用，请联系管理员");
      const row = await platformRow(env.DB, {
        workspaceId: env.SHANHAI_WORKSPACE_ID,
      });
      session = sessionFor(JSON.parse(row.data), user.userId);
    } catch (e) {
      session = {
        status: "unavailable",
        error:
          e instanceof Error && "status" in e
            ? e.message
            : "平台暂不可用，请联系管理员",
      };
    }
  }
  if (!login && session.status === "member" && session.portal !== portal)
    redirect(`/${session.portal}`);
  if (
    login ||
    session.status === "disabled" ||
    session.status === "unavailable" ||
    (portal === "operations" && session.status !== "member")
  )
    return (
      <PortalLogin
        portal={portal}
        session={session}
        displayName={user?.displayName || ""}
      />
    );
  return <CatalogApp displayName={user!.displayName} portal={portal} />;
}
