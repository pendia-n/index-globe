import { render, route } from "rwsdk/router";
import { defineApp } from "rwsdk/worker";
import { Document } from "@/app/document";
import { setCommonHeaders } from "@/app/headers";
import { currentUser, authApi } from "./auth";
import { AccountPage } from "./account";
import { PublicScreen } from "./pages";
import { Shell } from "./shell";
import { tradeRoutes } from "./trade";
import { pilotStatus, requestPilot, stripeWebhook } from "./billing";

export type AppContext = {};
type AccountRoute = "login" | "signup" | "recovery" | "profile" | "security";

function redirect(path: string) {
  return new Response(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store" } });
}

function account(page: AccountRoute) {
  return async ({ request }: { request: Request }) => {
    const user = await currentUser(request);
    const privatePage = page === "profile" || page === "security";
    if (privatePage && !user) return redirect("/login");
    if (!privatePage && user) return redirect("/workspace");
    return <Shell user={user}><AccountPage page={page} user={user ?? undefined} /></Shell>;
  };
}

export default defineApp([
  setCommonHeaders(),
  ({ request, response }) => {
    response.headers.set("Cache-Control", "no-store");
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (request.method === "POST" && url.pathname !== "/api/stripe/webhook" &&
        (origin ? origin !== url.origin : !url.pathname.startsWith("/api/auth/"))) {
      return new Response("Forbidden.", { status: 403 });
    }
  },
  render(Document, [
    route("/about", { get: async ({ request }) => <PublicScreen page="about" user={await currentUser(request)} /> }),
    route("/announcements", { get: async ({ request }) => <PublicScreen page="announcements" user={await currentUser(request)} /> }),
    route("/pricing", { get: async ({ request }) => {
      const user = await currentUser(request);
      return <PublicScreen page="pricing" user={user} pilotStatus={user ? await pilotStatus(user.id) : undefined} />;
    } }),
    route("/pricing/pilot", { post: async ({ request }) => {
      const user = await currentUser(request);
      if (!user) return redirect("/login");
      await requestPilot(user.id);
      return redirect("/pricing");
    } }),
    route("/login", { get: account("login") }),
    route("/signup", { get: account("signup") }),
    route("/recovery", { get: account("recovery") }),
    route("/profile", { get: account("profile") }),
    route("/security", { get: account("security") }),
    route("/api/auth/:action", {
      get: ({ request, params }) => authApi(request, params.action),
      post: ({ request, params }) => authApi(request, params.action),
    }),
    route("/api/stripe/webhook", { post: ({ request }) => stripeWebhook(request) }),
    ...tradeRoutes,
  ]),
]);
