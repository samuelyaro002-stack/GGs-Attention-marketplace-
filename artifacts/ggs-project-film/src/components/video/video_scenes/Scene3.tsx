import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { Stage, useBeats, EASE } from '../FilmParts';

const ROWS = ['Post submitted', 'Score recorded', 'Estimate visible'];

export function Scene3() {
  const beat = useBeats([450, 600, 1350, 2100, 2800, 3500, 4200]);
  return (
    <Stage name="ledger" className="ledger-scene">
      <h2 className="ledger-title">Earned in the open.</h2>
      <motion.div className="ledger-paper"
        initial={{ rotateX: 8, scale: 0.9 }}
        animate={{ rotateX: 0, scale: beat >= 7 ? 0.98 : 1 }}
        transition={{ duration: 0.65, ease: EASE }}>
        <div className="ledger-head"><span>CONTRIBUTION</span><span>XP</span><span>ALLOCATION</span></div>
        {ROWS.map((row, i) => (
          <motion.div className="ledger-row" key={row}
            initial={{ clipPath: 'inset(0 100% 0 0)' }}
            animate={{ clipPath: beat >= i + 2 ? 'inset(0 0% 0 0)' : 'inset(0 100% 0 0)' }}
            transition={{ duration: 0.45, ease: EASE }}>
            <span>{row}</span><Check /><span className="ledger-status">{['Submitted', 'Demo score', 'Estimated'][i]}</span>
          </motion.div>
        ))}
      </motion.div>
      <motion.div className="xp-stamp"
        animate={{ rotate: beat >= 5 ? 0 : -14, scale: beat >= 7 ? 1.5 : beat >= 5 ? 1 : 0.85, x: beat >= 7 ? '-7vmin' : 0 }}
        transition={{ duration: 0.65, ease: EASE }}>XP</motion.div>
      <motion.div className="ledger-sweep" initial={{ scaleX: 0.2 }} animate={{ scaleX: beat >= 6 ? 1 : 0.2 }} transition={{ duration: 0.5 }} />
      <p className="ledger-disclosure">MVP scoring is a demo. Campaign payouts require<br />an approved contract deployment.</p>
    </Stage>
  );
}