"use client";

import React from "react";
import { StackedCards, type GlassCardItem } from "@/components/ui/glass-cards";

export interface ScrollingImageItem extends GlassCardItem {}

interface ImagesScrollingAnimationProps {
  items: ScrollingImageItem[];
  className?: string;
  emptyState?: React.ReactNode;
  focusItemId?: string | number | null;
}

export const ImagesScrollingAnimation: React.FC<ImagesScrollingAnimationProps> = ({
  items,
  className,
  emptyState,
  focusItemId,
}) => {
  return <StackedCards items={items} className={className} emptyState={emptyState} focusItemId={focusItemId} />;
};
