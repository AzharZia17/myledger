import * as React from "react";
import { cn } from "@/lib/utils";
export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;
export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => <input ref={ref} className={cn("flex h-11 w-full rounded-md border border-zinc-200 bg-white px-3 text-base outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:ring-zinc-900", className)} {...props} />);
Input.displayName = "Input";
