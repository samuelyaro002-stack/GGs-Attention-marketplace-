import { motion } from 'framer-motion';
import { UserRound, Wallet } from 'lucide-react';
import { Stage, Reveal, useBeats, EASE } from '../FilmParts';

export function Scene5() {
  const beat = useBeats([450, 850, 1500, 2200, 3000, 3600, 4200]);
  return (
    <Stage name="account" className="account-scene">
      <div className="account-headings"><h2>Your account.</h2><Reveal delay={0.65}><h2>Your wallet.</h2></Reveal></div>
      <motion.div className="identity-tile account-tile" initial={{ rotate: -5 }} animate={{ rotate: 0, x: beat >= 7 ? '-3vmin' : 0, scale: beat >= 4 ? 1.02 : 1 }} transition={{ duration: 0.5, ease: EASE }}>
        <UserRound /><span>EMAIL / SOCIAL SIGN-IN</span>
      </motion.div>
      <motion.div className="identity-tile wallet-tile" initial={{ rotate: 5 }} animate={{ rotate: 0, x: beat >= 7 ? '3vmin' : 0, scale: beat >= 4 ? 1.02 : 1 }} transition={{ duration: 0.5, ease: EASE }}>
        <Wallet /><Reveal delay={1}><span>WALLET APPROVALS</span></Reveal>
      </motion.div>
      <motion.div className="identity-link" initial={{ scaleX: 0 }} animate={{ scaleX: beat >= 3 ? 1 : 0 }} transition={{ duration: 0.6 }} />
      <motion.div className="identity-diamond" animate={{ rotate: beat >= 5 ? 45 : 0, scale: beat >= 7 ? 1.8 : beat >= 5 ? 1 : 0.4 }} transition={{ duration: 0.6, ease: EASE }} />
      <Reveal className="identity-caption" delay={1.65}><p>Sign in to participate.<br />Approve transactions in your wallet.</p></Reveal>
    </Stage>
  );
}