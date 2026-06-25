"use client";

import { IconSettings, type Icon } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";

export function NavSecondary({
  items,
  ...props
}: {
  items: {
    title: string;
    url: string;
    icon?: Icon;
  }[];
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const navigate = useNavigate();

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton onClick={() => navigate({ to: item.url })}>
                {item.icon ? <item.icon /> : <IconSettings />}
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
