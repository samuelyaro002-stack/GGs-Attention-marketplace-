import { motion } from 'framer-motion';
import { Stage, Reveal, useBeats, EASE } from '../FilmParts';

export function Scene4() {
  const beat = useBeats([350, 800, 1600, 2450, 3300, 4100, 5050]);
  return (
    <Stage name="daily" className="daily-scene">
      <motion.div className="daily-coin"
        initial={{ scale: 1.15, rotate: -10 }}
        animate={{ rotate: beat >= 6 ? 8 : beat >= 4 ? 2 : -4, scale: beat >= 7 ? 0.87 : 1, x: beat >= 7 ? '5vmin' : 0 }}
        transition={{ duration: 0.7, ease: EASE }}>
        <span>G$</span>
        {[0, 1, 2].map(i => <motion.i className="coin-notch" key={i} style={{ rotate: `${i * 120}deg` }} animate={{ opacity: beat >= i + 3 ? 1 : 0.18 }} />)}
      </motion.div>
      <div className="daily-copy">
        <h2>Daily G$</h2>
        <Reveal delay={0.35}><p className="daily-subtitle">A separate<br />daily opportunity.</p></Reveal>
        <Reveal delay={0.8}><p className="daily-explainer">GoodDollar’s UBI pool —<br />not campaign rewards.</p></Reveal>
        <div className="daily-steps">
          {['Verify.', 'Check.', 'Claim.'].map((word, i) => <motion.span key={word}
            initial={{ opacity: 0.15, y: 4 }}
            animate={{ opacity: beat >= i + 3 ? 1 : 0.15, y: beat >= i + 3 ? 0 : 4 }}
            transition={{ duration: 0.3 }}>{word}</motion.span>)}
        </div>
      </div>
      <p className="daily-note">Eligibility and claim amounts vary.</p>
    </Stage>
  );
}