import { withUser } from "@/lib/apiHelpers";
import { getLlmCredentialStatus, deleteLlmCredential } from "@/lib/db/projects";
import { isCopilotConfigured } from "@/lib/copilot";

export const dynamic = "force-dynamic";

// GET /api/agent/credential — whether the signed-in user has connected Copilot.
// Reports existence and account only; the token never leaves the server.
export async function GET() {
  return withUser(async (userId) => ({
    configured: isCopilotConfigured(),
    ...(await getLlmCredentialStatus(userId)),
  }));
}

// DELETE /api/agent/credential — disconnect.
export async function DELETE() {
  return withUser((userId) => deleteLlmCredential(userId));
}
