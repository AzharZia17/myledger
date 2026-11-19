"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) { return <DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40"/><DialogPrimitive.Content className={cn("fixed z-50 left-1/2 top-1/2 max-h-[90vh] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-5 shadow-lg dark:border-zinc-800 dark:bg-zinc-950", className)} {...props}><DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm text-zinc-500 hover:text-zinc-900"><X className="h-4 w-4"/><span className="sr-only">Close</span></DialogPrimitive.Close>{children}</DialogPrimitive.Content></DialogPrimitive.Portal>; }
export const DialogHeader = ({className, ...props}: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("mb-4 pr-8", className)} {...props}/>;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
