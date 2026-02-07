import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Card item for HoverRevealCards component.
 * Supports either an icon (React node) or a background image URL.
 */
export interface CardItem {
    id: string | number;
    title: string;
    subtitle: string;
    icon?: React.ReactNode;
    imageUrl?: string;
    accentColor?: string; // Tailwind color class for icon background (e.g., 'blue', 'purple', 'emerald')
    onClick?: () => void;
}

export interface HoverRevealCardsProps {
    items: CardItem[];
    className?: string;
    cardClassName?: string;
}

/**
 * A component that displays a grid of cards with a hover-reveal effect.
 * When a card is hovered or focused, it stands out while others are de-emphasized.
 */
const HoverRevealCards: React.FC<HoverRevealCardsProps> = ({
    items,
    className,
    cardClassName,
}) => {
    return (
        <div
            role="list"
            className={cn(
                'group grid w-full max-w-4xl grid-cols-1 gap-6 md:grid-cols-3',
                className
            )}
        >
            {items.map((item) => (
                <button
                    key={item.id}
                    role="listitem"
                    aria-label={`${item.title}, ${item.subtitle}`}
                    onClick={item.onClick}
                    className={cn(
                        'relative flex flex-col items-center gap-4 p-8 cursor-pointer overflow-hidden rounded-2xl',
                        'bg-slate-800/50 border border-slate-700',
                        'shadow-lg transition-all duration-500 ease-in-out',
                        // On parent hover, apply these styles to all children
                        'group-hover:scale-[0.97] group-hover:opacity-60 group-hover:blur-[2px]',
                        // On child hover/focus, override parent hover styles
                        'hover:!scale-105 hover:!opacity-100 hover:!blur-none hover:bg-slate-800',
                        'hover:shadow-xl',
                        'focus-visible:!scale-105 focus-visible:!opacity-100 focus-visible:!blur-none',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background',
                        cardClassName
                    )}
                    style={item.imageUrl ? { backgroundImage: `url(${item.imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                >
                    {/* Icon with accent background */}
                    {item.icon && (
                        <div
                            className={cn(
                                'p-4 rounded-full transition-colors',
                                item.accentColor === 'blue' && 'bg-blue-500/10 text-blue-400 group-hover:bg-blue-500/20',
                                item.accentColor === 'purple' && 'bg-purple-500/10 text-purple-400 group-hover:bg-purple-500/20',
                                item.accentColor === 'emerald' && 'bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500/20',
                                !item.accentColor && 'bg-slate-700/50 text-slate-300'
                            )}
                        >
                            {item.icon}
                        </div>
                    )}

                    {/* Gradient overlay for image backgrounds */}
                    {item.imageUrl && (
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
                    )}

                    {/* Card Content */}
                    <div className={cn('text-center', item.imageUrl && 'absolute bottom-0 left-0 right-0 p-6')}>
                        <h3 className="text-xl font-medium text-slate-200">{item.title}</h3>
                        <p className="text-sm text-slate-500 mt-1">{item.subtitle}</p>
                    </div>
                </button>
            ))}
        </div>
    );
};

export default HoverRevealCards;
