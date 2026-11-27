import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Pause, Play, Repeat, Volume2, VolumeX, ChevronDown, ChevronUp } from 'lucide-react';
import VideoTemplate, { SCENE_DURATIONS } from './VideoTemplate';
import { useSceneControls } from './useSceneControls';
import { SCENE_DETAILS } from './sceneMeta';

function formatTime(ms: number) {
  const secs = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

function PlaybackStatus({ sceneKeys, activeIndex, activeDuration, activeStartTime, totalDuration, tick, paused, onJumpTo }: {
  sceneKeys: string[]; activeIndex: number; activeDuration: number; activeStartTime: number; totalDuration: number; tick: number; paused: boolean; onJumpTo: (index: number) => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const baseRef = useRef(0);
  useEffect(() => { setElapsed(0); baseRef.current = 0; }, [tick]);
  useEffect(() => {
    if (paused) return;
    const start = performance.now();
    const id = window.setInterval(() => setElapsed(baseRef.current + performance.now() - start), 60);
    return () => { window.clearInterval(id); baseRef.current += performance.now() - start; };
  }, [tick, paused]);
  const progress = activeDuration > 0 ? Math.min(1, elapsed / activeDuration) : 0;
  const totalElapsed = Math.min(totalDuration, activeStartTime + Math.min(elapsed, activeDuration));
  return <>
    <div className="flex flex-1 items-center gap-1.5">
      {sceneKeys.map((key, i) => <button key={key} onClick={() => onJumpTo(i)}
        className="relative h-3 min-h-[12px] flex-1 overflow-hidden rounded-full bg-white/20 hover:h-4"
        aria-label={`Jump to scene ${i + 1}: ${SCENE_DETAILS[key].title}`} aria-current={i === activeIndex ? 'true' : undefined}>
        <div className="absolute inset-y-0 left-0 rounded-full bg-white/90" style={{ width: `${i === activeIndex ? progress * 100 : 0}%` }} />
      </button>)}
    </div>
    <span className="shrink-0 font-mono text-xl text-white/60">{activeIndex + 1}/{sceneKeys.length}</span>
    <span className="min-w-[11ch] shrink-0 text-right font-mono text-xl text-white/80 tabular-nums" role="timer"
      aria-label={`Playback time ${formatTime(totalElapsed)} of ${formatTime(totalDuration)}`}>{formatTime(totalElapsed)} / {formatTime(totalDuration)}</span>
  </>;
}

export default function VideoWithControls() {
  const isIframed = window.self !== window.top;
  const controls = useSceneControls(SCENE_DURATIONS);
  const [muted, setMuted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [tapPinned, setTapPinned] = useState(false);
  const sensorRef = useRef<HTMLDivElement>(null);
  const handleJump = useCallback((index: number) => {
    controls.jumpTo(index);
    const details = SCENE_DETAILS[controls.sceneKeys[index]];
    if (details?.filePath) window.parent.postMessage({ type: 'REPLIT_VIDEO_SCENE_SELECTED', payload: { sceneIndex: index, sceneCount: controls.sceneKeys.length, sceneTitle: details.title, filePath: details.filePath, lineNumber: 1 } }, '*');
  }, [controls.jumpTo, controls.sceneKeys]);
  useEffect(() => {
    if (!controls.paused) return;
    const frozen = document.getAnimations().filter(a => a.playState === 'running');
    frozen.forEach(a => a.pause());
    return () => frozen.forEach(a => a.play());
  }, [controls.paused]);
  useEffect(() => {
    if (!(collapsed && tapPinned)) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' && !sensorRef.current?.contains(e.target as Node)) setTapPinned(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [collapsed, tapPinned]);
  const onEnter = (e: ReactPointerEvent) => { if (e.pointerType === 'mouse') setHovering(true); };
  const onLeave = (e: ReactPointerEvent) => { if (e.pointerType === 'mouse') setHovering(false); };
  const toggleCollapsed = () => { if (!collapsed) { setHovering(false); setTapPinned(false); } setCollapsed(x => !x); };
  const barVisible = !collapsed || hovering || tapPinned;
  const buttonClass = 'flex h-14 w-14 shrink-0 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white';
  if (!isIframed) return <VideoTemplate />;
  return <div className="relative h-screen w-full">
    <VideoTemplate key={controls.mountKey} durations={controls.durations} loop paused={controls.paused} muted={muted} onSceneChange={controls.onSceneChange} />
    <div ref={sensorRef} className="absolute inset-x-0 bottom-0 z-50 flex flex-col justify-end" style={{ height: '25%' }} onPointerEnter={onEnter} onPointerLeave={onLeave}
      onPointerDown={e => { if (e.pointerType !== 'mouse' && collapsed) setTapPinned(true); }}>
      <div className="w-full flex-1" aria-hidden="true" />
      <div className={`flex items-center gap-3 bg-black/65 px-5 py-4 backdrop-blur-sm transition-all duration-200 ${barVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-full opacity-0'}`} aria-hidden={!barVisible} inert={!barVisible}>
        <button className={buttonClass} onClick={controls.togglePause} aria-label={controls.paused ? 'Play' : 'Pause'}>{controls.paused ? <Play size={32} /> : <Pause size={32} />}</button>
        <button className={buttonClass} onClick={controls.toggleLock} aria-label={`Loop current scene: ${controls.locked ? 'on' : 'off'}`} aria-pressed={controls.locked}><Repeat size={32} /></button>
        <button className={buttonClass} onClick={() => setMuted(x => !x)} aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted}>{muted ? <VolumeX size={32} /> : <Volume2 size={32} />}</button>
        <div className="w-px self-stretch bg-white/15" />
        <PlaybackStatus {...controls} onJumpTo={handleJump} />
        <button className={buttonClass} onClick={toggleCollapsed} aria-label={collapsed ? 'Show controls' : 'Hide controls'} aria-expanded={!collapsed}>{collapsed ? <ChevronUp size={40} /> : <ChevronDown size={40} />}</button>
      </div>
    </div>
  </div>;
}