import { useEffect, useRef, type ComponentType } from 'react';
import { VideoCanvas, VideoPausedContext, type VideoAspectRatio, useVideoPlayer } from '@/lib/video';
import { AnimatePresence, motion } from 'framer-motion';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';
import { Scene6 } from './video_scenes/Scene6';
import './film.css';

export const SCENE_DURATIONS = { attention: 4000, campaigns: 5000, ledger: 5000, daily: 6000, account: 5000, brand: 5000 };
const SCENE_START_SEC: Record<string, number> = {};
let cumulativeMs = 0;
for (const [key, ms] of Object.entries(SCENE_DURATIONS)) {
  SCENE_START_SEC[key] = cumulativeMs / 1000;
  cumulativeMs += ms;
}
const VIDEO_ASPECT_RATIO: VideoAspectRatio = '16:9';
const SCENES: Record<string, ComponentType> = { attention: Scene1, campaigns: Scene2, ledger: Scene3, daily: Scene4, account: Scene5, brand: Scene6 };
const FIELDS = ['#f8f4ed', '#1d202f', '#ff8259', '#f8f4ed', '#1d202f', '#f8f4ed'];
// Explicit ownership/position for each scene; the opener owns its filled disc.
const RINGS = [
  { left: '66%', top: '17%', scale: 1, opacity: 0 },
  { left: '66%', top: '20%', scale: 0.8, opacity: 0.12 },
  { left: '68%', top: '22%', scale: 0.4, opacity: 0.2 },
  { left: '8%', top: '16%', scale: 1.04, opacity: 0.28 },
  { left: '31.5%', top: '17%', scale: 0.18, opacity: 0.3 },
  { left: '85%', top: '18%', scale: 0.8, opacity: 0.12 },
];

export default function VideoTemplate({
  durations = SCENE_DURATIONS, loop = true, paused = false, muted = false, onSceneChange,
}: { durations?: Record<string, number>; loop?: boolean; paused?: boolean; muted?: boolean; onSceneChange?: (key: string) => void } = {}) {
  const { currentSceneKey } = useVideoPlayer({ durations, loop, paused });
  useEffect(() => { onSceneChange?.(currentSceneKey); }, [currentSceneKey, onSceneChange]);
  const baseKey = currentSceneKey.replace(/_r[12]$/, '');
  const sceneIndex = Object.keys(SCENE_DURATIONS).indexOf(baseKey);
  const Scene = SCENES[baseKey];
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastSceneKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0.45;
    if (paused) { audio.pause(); return; }
    const syncAudio = () => {
      if (lastSceneKeyRef.current !== currentSceneKey) {
        lastSceneKeyRef.current = currentSceneKey;
        const target = SCENE_START_SEC[baseKey] ?? 0;
        if (Math.abs(audio.currentTime - target) > 0.18) audio.currentTime = target;
      }
      void audio.play().then(() => { audio.dataset.playback = 'playing'; }).catch(() => {
        audio.dataset.playback = 'autoplay-blocked';
      });
    };
    if (audio.readyState >= 1) syncAudio();
    else audio.addEventListener('loadedmetadata', syncAudio, { once: true });
    return () => audio.removeEventListener('loadedmetadata', syncAudio);
  }, [currentSceneKey, baseKey, paused, muted]);
  return (
    <VideoPausedContext.Provider value={paused}>
      <VideoCanvas aspectRatio={VIDEO_ASPECT_RATIO} className="film">
        <motion.div className="film-camera" initial={false} animate={{ backgroundColor: FIELDS[sceneIndex], scale: sceneIndex % 2 ? 1.006 : 1, rotate: sceneIndex % 2 ? 0.15 : 0 }} transition={{ duration: 0.45 }}>
          <motion.div className="persistent-ring" initial={false} animate={RINGS[sceneIndex]} transition={{ duration: 0.55 }} />
          <AnimatePresence mode="sync">{Scene && <Scene key={currentSceneKey} />}</AnimatePresence>
        </motion.div>
        <audio ref={audioRef} src={`${import.meta.env.BASE_URL}audio/bg_music.mp3`} preload="auto" autoPlay muted={muted}
          onError={() => console.error('The GG film soundtrack could not be loaded.')} />
      </VideoCanvas>
    </VideoPausedContext.Provider>
  );
}
