import { useEffect, useState } from 'react';

export const useFadeIn = (delay: number = 0) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  return isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4';
};