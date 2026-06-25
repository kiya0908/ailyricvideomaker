"use client";

import { Button } from "@workspace/ui/components/button";
import { Separator } from "@workspace/ui/components/separator";
import { SidebarTrigger } from "@workspace/ui/components/sidebar";

export function SiteHeader() {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="text-base font-medium">Dashboard</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="hidden sm:flex"
            render={
              <a
                href="https://github.com/backpine/saas-kit"
                rel="noopener noreferrer"
                target="_blank"
                className="dark:text-foreground"
              />
            }
          >
            GitHub
          </Button>
        </div>
      </div>
    </header>
  );
}
