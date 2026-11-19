"use client";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";
export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export function DropdownMenuContent({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) { return <DropdownMenuPrimitive.Portal><DropdownMenuPrimitive.Content sideOffset={6} className={cn("z-50 min-w-36 rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-md dark:border-zinc-800 dark:bg-zinc-950", className)} {...props}/></DropdownMenuPrimitive.Portal>; }
export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) { return <DropdownMenuPrimitive.Item className={cn("flex cursor-pointer select-none items-center rounded-sm px-3 py-2 outline-none hover:bg-zinc-100 dark:hover:bg-zinc-900", className)} {...props}/>; }
