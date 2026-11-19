import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { asChild?: boolean; variant?: "default" | "outline" | "ghost" | "danger"; size?: "default" | "sm" | "icon" }
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant="default", size="default", asChild=false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50", variant === "default" && "bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white", variant === "outline" && "border border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900", variant === "ghost" && "hover:bg-zinc-100 dark:hover:bg-zinc-900", variant === "danger" && "bg-red-600 text-white hover:bg-red-700", size === "default" && "h-11 px-4", size === "sm" && "h-9 px-3", size === "icon" && "h-9 w-9", className)} {...props} />;
});
Button.displayName = "Button";
