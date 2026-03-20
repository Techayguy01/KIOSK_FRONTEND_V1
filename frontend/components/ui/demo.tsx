"use client";

import { CardStack, CardStackItem } from "@/components/ui/card-stack";

const items: CardStackItem[] = [
  {
    id: 1,
    title: "Luxury Performance",
    description: "Experience the thrill of precision engineering",
    imageSrc: "https://images.unsplash.com/photo-1493238792000-8113da705763?auto=format&fit=crop&w=1200&q=80",
    href: "https://unsplash.com",
  },
  {
    id: 2,
    title: "Elegant Design",
    description: "Where beauty meets functionality",
    imageSrc: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1200&q=80",
    href: "https://unsplash.com",
  },
  {
    id: 3,
    title: "Power & Speed",
    description: "Unleash the true potential of the road",
    imageSrc: "https://images.unsplash.com/photo-1511919884226-fd3cad34687c?auto=format&fit=crop&w=1200&q=80",
    href: "https://unsplash.com",
  },
  {
    id: 4,
    title: "Timeless Craftsmanship",
    description: "Built with passion, driven by excellence",
    imageSrc: "https://images.unsplash.com/photo-1485291571150-772bcfc10da5?auto=format&fit=crop&w=1200&q=80",
    href: "https://unsplash.com",
  },
  {
    id: 5,
    title: "Future of Mobility",
    description: "Innovation that moves you forward",
    imageSrc: "https://images.unsplash.com/photo-1542282088-fe8426682b8f?auto=format&fit=crop&w=1200&q=80",
    href: "https://unsplash.com",
  },
];

export default function CardStackDemoPage() {
  return (
    <div className="w-full">
      <div className="mx-auto w-full max-w-5xl p-8">
        <CardStack
          items={items}
          initialIndex={0}
          autoAdvance
          intervalMs={3000}
          pauseOnHover
          showDots
        />
      </div>
    </div>
  );
}

