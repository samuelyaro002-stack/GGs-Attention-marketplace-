import { motion } from 'framer-motion';
import { FileText, Send } from 'lucide-react';
import { Stage, Reveal, useBeats, EASE } from '../FilmParts';

export function Scene2() {
  const beat = useBeats([350, 900, 1350, 1800, 2450, 3100, 3800, 4200]);
  return (
    <Stage name="campaigns" className="campaigns">
      <h2 className="campaign-title">Projects set the brief.</h2>
      <motion.div className="paper brief-paper"
        initial={{ rotate: -8, scale: 0.94 }}
        animate={{ rotate: beat >= 6 ? 0 : -3, scale: beat >= 8 ? 1.06 : 1, x: beat >= 8 ? '2vmin' : 0 }}
        transition={{ duration: 0.5, ease: EASE }}>
        <div className="paper-top"><FileText /><span>CAMPAIGN BRIEF</span></div>
        <Reveal delay={0.6}><h3>Create something<br />worth noticing.</h3></Reveal>
        <div className="paper-lines">{[0, 1, 2].map(i => <motion.span key={i} initial={{ scaleX: 0 }} animate={{ scaleX: beat >= 2 ? 1 : 0 }} transition={{ delay: i * 0.1, duration: 0.5 }} />)}</div>
        <span className="paper-seal">GG</span>
      </motion.div>
      <motion.div className="paper creator-paper"
        initial={{ rotate: 8, scale: 0.65 }}
        animate={{ rotate: beat >= 6 ? 0 : 4, scale: beat >= 8 ? 1.11 : beat >= 3 ? 1 : 0.75, y: beat >= 7 ? '-1.5vmin' : 0 }}
        transition={{ duration: 0.55, ease: EASE }}>
        <div className="paper-top"><Send /><span>CREATOR CONTRIBUTION</span></div>
        <Reveal delay={1.65}><h3>Make.<br />Post. Submit.</h3></Reveal>
        <motion.div className="signal-mark" animate={{ rotate: beat >= 5 ? 45 : 0, scale: beat >= 7 ? 1.08 : 1 }} />
      </motion.div>
      <motion.div className="connection-rule" initial={{ scaleX: 0 }} animate={{ scaleX: beat >= 5 ? 1 : 0 }} transition={{ duration: 0.65 }} />
      <Reveal className="creator-caption" delay={1.4}><p>Creators bring the signal.</p></Reveal>
      <p className="scene-note">Illustrative campaign flow</p>
    </Stage>
  );
}