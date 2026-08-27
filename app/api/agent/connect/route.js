import { withUser } from "@/lib/apiHelpers";
import { saveLlmCredential } from "@/lib/db/projects";
import {
  startDeviceFlow,
  pollDeviceFlow,
  githubLoginForToken,
  isCopilotConfigured,
} from "@/lib/copilot";

export const dynamic = "force-dynamic";

// POST /api/agent/connect — drive the GitHub device flow.
//
// Two steps on one route, distinguished by the body:
//   {}                  -> start, returns a code for the user to enter
//   { deviceCode }      -> poll; on success the token is stored ENCRYPTED and
//                          never returned to the browser
//
// The device code itself is short-lived and useless without the user
// completing sign-in on github.com, so round-tripping it through the client is
// safe and avoids server-side flow state.
export async function POST(req) {
  const body = await req.json().catch(() => ({}));

  return withUser(async (userId) => {
    if (!isCopilotConfigured()) {
      return Response.json(
        { error: "Copilot isn't configured on this deployment." },
        { status: 501 }
      );
    }

    if (!body.deviceCode) {
      const flow = await startDeviceFlow();
      return {
        deviceCode: flow.deviceCode,
        userCode: flow.userCode,
        verificationUri: flow.verificationUri,
        interval: flow.interval,
      };
    }

    const result = await pollDeviceFlow(body.deviceCode);
    if (result.status !== "complete") return { status: result.status };

    const login = await githubLoginForToken(result.token);
    const status = await saveLlmCredential(userId, result.token, {
      accountLogin: login,
    });
    return { status: "complete", ...status };
  });
}
