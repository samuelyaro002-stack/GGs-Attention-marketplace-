import { motion } from 'framer-motion';
import { Stage, Label, Reveal, useBeats, EASE } from '../FilmParts';

export function Scene1() {
  const beat = useBeats([450, 900, 1450, 1900, 2500, 3250]);
  return (
    <Stage name="attention" className="opener">
      <Label>GG / ATTENTION MARKETPLACE</Label>
      <motion.div className="attention-disc"
        initial={{ scale: 0.75, rotate: -15 }}
        animate={{ scale: beat >= 6 ? 1.3 : beat >= 2 ? 1 : beat >= 1 ? 0.9 : 0.75, rotate: beat >= 4 ? 10 : 0, x: beat >= 6 ? '-8vmin' : 0 }}
        transition={{ type: 'spring', stiffness: 290, damping: 30 }}>
        <span className="disc-cross" />
      </motion.div>
      <motion.div className="opener-type"
        animate={{ y: beat >= 6 ? '-2vmin' : 0, letterSpacing: beat >= 5 ? '-.065em' : '-.045em' }}
        transition={{ duration: 0.5, ease: EASE }}>
        <h1>Attention</h1>
        <Reveal delay={0.55}><h2>is an asset.</h2></Reveal>
      </motion.div>
      <Reveal className="opener-payoff" delay={1.45}><p>Put it to work.</p></Reveal>
      <motion.div className="bottom-rule" initial={{ scaleX: 0.35 }} animate={{ scaleX: beat >= 3 ? 1 : 0.5 }} />
    </Stage>
  );
}