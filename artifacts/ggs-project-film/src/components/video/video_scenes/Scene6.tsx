import { motion } from 'framer-motion';
import { Stage, Label, Reveal, useBeats, EASE } from '../FilmParts';

export function Scene6() {
  const beat = useBeats([450, 1250, 2000, 2800, 3600, 4150]);
  return (
    <Stage name="brand" className="brand-scene">
      <Label>GG’s Attention Marketplace</Label>
      <motion.div className="brand-lockup" initial={{ scale: 0.92 }}
        animate={{ scale: beat >= 6 ? 1.025 : 1, y: beat >= 5 ? '-0.5vmin' : 0 }}
        transition={{ duration: 0.65, ease: EASE }}>
        <img src={`${import.meta.env.BASE_URL}images/logo.svg`} alt="GG.ATTENTION" />
        <Reveal delay={0.45}><h2>Make your attention count.</h2></Reveal>
        <Reveal delay={1.25}><p>Campaigns. Creators. Transparency.</p></Reveal>
      </motion.div>
      <motion.div className="brand-disc" animate={{ scale: beat >= 4 ? 1 : 0.8, x: beat >= 6 ? '-2vmin' : 0 }} transition={{ duration: 0.65 }} />
      <motion.div className="bottom-rule" initial={{ scaleX: 0.3 }} animate={{ scaleX: beat >= 3 ? 1 : 0.3 }} transition={{ duration: 0.65 }} />
    </Stage>
  );
}