"use client";

import * as React from "react";
import {
  IconChartBar,
  IconCreditCard,
  IconDashboard,
  IconDatabase,
  IconFolder,
  IconHelp,
  IconInnerShadowTop,
  IconListDetails,
  IconReport,
  IconSearch,
  IconSettings,
  IconUsers,
  IconVideo,
} from "@tabler/icons-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import { NavDocuments } from "./nav-documents";
import { NavMain } from "./nav-main";
import { NavSecondary } from "./nav-secondary";
import { NavUser } from "./nav-user";

const data = {
  navMain: [
    {
      title: "Dashboard",
      url: "/app",
      icon: IconDashboard,
    },
    {
      title: "Subscriptions",
      url: "/app/polar/subscriptions",
      icon: IconCreditCard,
    },
    {
      title: "Lyric Videos",
      url: "/app/lyric-videos",
      icon: IconVideo,
    },
    {
      title: "Analytics",
      url: "/app/analytics",
      icon: IconChartBar,
    },
    {
      title: "Projects",
      url: "/app/projects",
      icon: IconFolder,
    },
    {
      title: "Team",
      url: "/app/team",
      icon: IconUsers,
    },
  ],
  navSecondary: [
    {
      title: "Settings",
      url: "/app/settings",
      icon: IconSettings,
    },
    {
      title: "Get Help",
      url: "/app/help",
      icon: IconHelp,
    },
    {
      title: "Search",
      url: "/app/search",
      icon: IconSearch,
    },
  ],
  documents: [
    {
      name: "Data Library",
      url: "/app/data",
    },
    {
      name: "Reports",
      url: "/app/reports",
    },
    {
      name: "Documentation",
      url: "/app/docs",
    },
  ],
};

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<a href="/app" />}
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <IconInnerShadowTop className="!size-5" />
              <span className="text-base font-semibold">SaaS Kit</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavDocuments items={data.documents} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
