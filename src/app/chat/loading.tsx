"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  ChatLayoutSkeleton,
  HomeChatSkeleton,
} from "@/components/ui/skeletons/page-skeletons";

function ChatRouteSkeleton() {
  const params = useSearchParams();
  // Home is the hero composer. A deep-linked /chat?chat= id is a thread —
  // keep the conversation skeleton so opening history is never a blank frame.
  return params.get("chat") ? <ChatLayoutSkeleton /> : <HomeChatSkeleton />;
}

export default function ChatLoading() {
  return (
    <Suspense fallback={<HomeChatSkeleton />}>
      <ChatRouteSkeleton />
    </Suspense>
  );
}
