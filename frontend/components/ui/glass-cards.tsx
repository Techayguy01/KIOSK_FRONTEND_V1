"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { cn } from "@/lib/utils";
import { optimizeCloudinaryUrl } from "@/lib/cloudinary";

gsap.registerPlugin(ScrollTrigger);

export interface GlassCardItem {
  id: string | number;
  title: string;
  description?: string;
  src: string;
  color?: string;
}

interface CardProps {
  item: GlassCardItem;
  index: number;
  totalCards: number;
  scroller: HTMLDivElement | null;
}

interface StackedCardsProps {
  items: GlassCardItem[];
  className?: string;
  emptyState?: React.ReactNode;
  focusItemId?: string | number | null;
}

const DEFAULT_COLORS = [
  "rgba(56, 189, 248, 0.82)",
  "rgba(34, 197, 94, 0.78)",
  "rgba(251, 191, 36, 0.8)",
  "rgba(244, 114, 182, 0.78)",
  "rgba(168, 85, 247, 0.8)",
];

const Card: React.FC<CardProps> = ({ item, index, totalCards, scroller }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const card = cardRef.current;
    const container = containerRef.current;
    if (!card || !container || !scroller) return;

    const targetScale = Math.max(0.82, 1 - (totalCards - index - 1) * 0.06);
    gsap.set(card, {
      opacity: 0,
      y: 56,
      scale: 1,
      transformOrigin: "center top",
    });

    const trigger = ScrollTrigger.create({
      trigger: container,
      scroller,
      start: "top 72%",
      end: "bottom 18%",
      scrub: 0.9,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        const scale = gsap.utils.interpolate(1, targetScale, self.progress);
        const entranceProgress = gsap.utils.clamp(0, 1, (self.progress - 0.12) / 0.28);
        const opacity = gsap.utils.interpolate(0, 1, entranceProgress);
        const yOffset = gsap.utils.interpolate(56, 0, entranceProgress);
        gsap.set(card, {
          scale: Math.max(scale, targetScale),
          opacity,
          y: yOffset,
          transformOrigin: "center top",
        });
      },
    });

    const refreshId = window.requestAnimationFrame(() => {
      trigger.refresh();
      ScrollTrigger.refresh();
    });

    return () => {
      window.cancelAnimationFrame(refreshId);
      trigger.kill();
    };
  }, [index, scroller, totalCards]);

  return (
    <div
      ref={containerRef}
      className="relative flex h-[54vh] items-start justify-center sm:h-[58vh] lg:h-[62vh]"
    >
      <div
        ref={cardRef}
        style={{ top: `calc(8vh + ${index * 16}px)` }}
        className="sticky flex h-[320px] w-full max-w-[560px] origin-top items-stretch rounded-[28px] sm:h-[380px] md:h-[420px] lg:h-[450px]"
      >
        <div
          className="relative h-full w-full overflow-hidden rounded-[28px] bg-slate-950 shadow-[0_20px_60px_rgba(0,0,0,0.42)]"
        >
          <img src={item.src} alt={item.title} className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/72 via-slate-950/10 to-transparent" />

          <div className="absolute inset-x-0 bottom-0 p-6 sm:p-7">
            <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-200/85">Hotel Preview</p>
            <h3 className="mt-3 text-2xl font-medium text-white sm:text-[28px]">{item.title}</h3>
            {item.description ? (
              <p className="mt-2 max-w-[85%] text-sm leading-relaxed text-white/70 sm:text-[15px]">
                {item.description}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export const StackedCards: React.FC<StackedCardsProps> = ({ items, className, emptyState, focusItemId = null }) => {
  const viewportRef = useRef<HTMLDivElement>(null);

  const normalizedItems = useMemo(
    () =>
      items
        .map((item, index) => ({
          ...item,
          src: optimizeCloudinaryUrl(String(item.src || "").trim()),
          color: item.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length],
        }))
        .filter((item) => item.src),
    [items],
  );
  const itemsSignature = useMemo(
    () => normalizedItems.map((item) => `${String(item.id)}:${item.src}`).join("|"),
    [normalizedItems],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || normalizedItems.length === 0) return;

    viewport.scrollTop = 0;
    gsap.killTweensOf(viewport);
    gsap.set(viewport, { opacity: 1 });

    const ctx = gsap.context(() => {
      gsap.fromTo(
        viewport,
        { opacity: 0 },
        { opacity: 1, duration: 0.7, ease: "power2.out" },
      );
    }, viewport);

    ScrollTrigger.refresh();
    return () => ctx.revert();
  }, [itemsSignature, normalizedItems.length]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || normalizedItems.length <= 1) return;

    const updateMaxScroll = () => Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    let maxScroll = updateMaxScroll();
    if (maxScroll <= 0) return;

    const autoTween = gsap.to(viewport, {
      scrollTop: maxScroll,
      duration: Math.max(18, normalizedItems.length * 9),
      ease: "none",
      repeat: -1,
      yoyo: true,
      repeatDelay: 1.2,
    });

    const handleResize = () => {
      maxScroll = updateMaxScroll();
      autoTween.vars.scrollTop = maxScroll;
      autoTween.invalidate().restart();
      ScrollTrigger.refresh();
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      autoTween.kill();
    };
  }, [itemsSignature, normalizedItems.length]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || focusItemId == null) return;

    const targetIndex = normalizedItems.findIndex((item) => String(item.id) === String(focusItemId));
    if (targetIndex < 0) return;

    const target = viewport.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(String(focusItemId))}"]`);
    if (!target) return;

    gsap.to(viewport, {
      scrollTop: Math.max(0, target.offsetTop - viewport.clientHeight * 0.12),
      duration: 1.2,
      ease: "power2.out",
      overwrite: true,
      onComplete: () => ScrollTrigger.refresh(),
    });
  }, [focusItemId, normalizedItems]);

  if (normalizedItems.length === 0) {
    return (
      <div className={cn("flex h-full min-h-[320px] items-center justify-center", className)}>
        {emptyState ?? <p className="text-sm text-white/45">No hotel images available.</p>}
      </div>
    );
  }

  return (
    <div className={cn("relative h-full w-full overflow-hidden", className)}>
      <div
        ref={viewportRef}
        className="absolute inset-0 overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        <div className="mx-auto w-full max-w-[720px] pb-[12vh] pt-[2vh]">
          {normalizedItems.map((item, index) => (
            <div key={item.id} data-card-id={String(item.id)}>
              <Card
                item={item}
                index={index}
                totalCards={normalizedItems.length}
                scroller={viewportRef.current}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
