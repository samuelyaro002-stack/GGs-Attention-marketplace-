import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { useSceneTimer } from '@/lib/video';

export const EASE = [0.22, 1, 0.36, 1] as const;

export function useBeats(times: number[]) {
  const [beat, setBeat] = useState(0);
  useSceneTimer(times.map((time, i) => ({ time, callback: () => setBeat(i + 1) })));
  return beat;
}

export function Stage({ children, name, className = '' }: { children: ReactNode; name: string; className?: string }) {
  return (
    <motion.section
      data-scene={name}
      className={`film-scene ${className}`}
      initial={{ scale: 1.035 }}
      animate={{ scale: 1 }}
      exit={{ opacity: 0, scale: 1.08 }}
      transition={{ duration: 0.36, ease: EASE }}
    >
      {children}
    </motion.section>
  );
}

export function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <div className={`reveal-mask ${className}`}>
      <motion.div initial={{ y: '105%' }} animate={{ y: 0 }} transition={{ delay, duration: 0.55, ease: EASE }}>
        {children}
      </motion.div>
    </div>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <p className="film-label">{children}</p>;
}