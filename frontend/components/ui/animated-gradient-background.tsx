import { motion } from "framer-motion";
import React, { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";

interface AnimatedGradientBackgroundProps {
    startingGap?: number;
    Breathing?: boolean;
    gradientColors?: string[];
    gradientStops?: number[];
    animationSpeed?: number;
    breathingRange?: number;
    containerStyle?: React.CSSProperties;
    containerClassName?: string;
    topOffset?: number;
}

const AnimatedGradientBackground: React.FC<AnimatedGradientBackgroundProps> = ({
    startingGap = 125,
    Breathing = false,
    gradientColors = [
        "#0A0A0A",
        "#2979FF",
        "#FF80AB",
        "#FF6D00",
        "#FFD600",
        "#00E676",
        "#3D5AFE"
    ],
    gradientStops = [35, 50, 60, 70, 80, 90, 100],
    animationSpeed = 0.02,
    breathingRange = 5,
    containerStyle = {},
    topOffset = 0,
    containerClassName = "",
}) => {
    const prefersReducedMotion = usePrefersReducedMotion();

    if (gradientColors.length !== gradientStops.length) {
        throw new Error(
            `GradientColors and GradientStops must have the same length.`
        );
    }

    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        let animationFrame: number;
        let width = startingGap;
        let directionWidth = 1;
        const effectiveBreathing = Breathing && !prefersReducedMotion;

        const applyGradient = (nextWidth: number) => {
            const gradientStopsString = gradientStops
                .map((stop, index) => `${gradientColors[index]} ${stop}%`)
                .join(", ");

            const gradient = `radial-gradient(${nextWidth}% ${nextWidth + topOffset}% at 50% 20%, ${gradientStopsString})`;

            if (containerRef.current) {
                containerRef.current.style.background = gradient;
            }
        };

        const animateGradient = () => {
            if (width >= startingGap + breathingRange) directionWidth = -1;
            if (width <= startingGap - breathingRange) directionWidth = 1;

            if (!effectiveBreathing) directionWidth = 0;
            width += directionWidth * animationSpeed;

            applyGradient(width);

            animationFrame = requestAnimationFrame(animateGradient);
        };

        applyGradient(startingGap);
        if (effectiveBreathing) {
            animationFrame = requestAnimationFrame(animateGradient);
        }

        return () => {
            if (animationFrame) cancelAnimationFrame(animationFrame);
        };
    }, [startingGap, Breathing, gradientColors, gradientStops, animationSpeed, breathingRange, topOffset, prefersReducedMotion]);

    return (
        <div className={`absolute inset-0 overflow-hidden ${containerClassName}`}>
            <motion.div
                key="animated-gradient-background"
                initial={prefersReducedMotion ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 1.5 }}
                animate={{
                    opacity: 1,
                    scale: 1,
                    transition: { duration: prefersReducedMotion ? 0 : 2, ease: [0.25, 0.1, 0.25, 1] },
                }}
                style={{ position: 'absolute', inset: 0 }}
            >
                <div
                    ref={containerRef}
                    style={containerStyle}
                    className="absolute inset-0 transition-transform"
                />
            </motion.div>
        </div>
    );
};

export default AnimatedGradientBackground;
