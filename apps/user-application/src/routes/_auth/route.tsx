import { createFileRoute, Outlet } from "@tanstack/react-router";
import { GoogleLogin } from "@/components/auth/google-login";
import { authClient } from "@/lib/auth-client";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { SiteHeader } from "@/components/dashboard/site-header";
import { SidebarInset, SidebarProvider } from "@workspace/ui/components/sidebar";

export const Route = createFileRoute("/_auth")({
  component: RouteComponent,
});

function RouteComponent() {
  const session = authClient.useSession();

  return (
    <>
      {session.isPending ? (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : session.data ? (
        <SidebarProvider
          defaultOpen
          style={{ "--sidebar-width": "18rem" } as React.CSSProperties}
        >
          <AppSidebar variant="inset" />
          <SidebarInset>
            <SiteHeader />
            <div className="flex flex-1 flex-col">
              <main className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-7xl">
                  <Outlet />
                </div>
              </main>
            </div>
          </SidebarInset>
        </SidebarProvider>
      ) : (
        <GoogleLogin />
      )}
    </>
  );
}
